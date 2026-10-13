"""Admin CRUD Lambda for the Agents table (C2).

Fronted by an API Gateway HTTP API with a Cognito JWT authorizer, so every
request is already authenticated. This handler additionally enforces that
mutations (POST/PUT/DELETE) come from a member of the Cognito `admin` group.
Reads (GET) are allowed for any authenticated user so the end-user picker can
reuse GET /agents.

Only the standard library + boto3 are used (boto3 ships in the Lambda runtime),
so there is nothing to bundle.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from urllib.parse import unquote

import boto3
from boto3.dynamodb.conditions import Key

TABLE_NAME = os.environ["AGENTS_TABLE"]
_table = boto3.resource("dynamodb").Table(TABLE_NAME)

# C7: read-only conversations table (may be unset in older deployments).
CONVERSATIONS_TABLE = os.environ.get("CONVERSATIONS_TABLE", "")
_conversations = (
    boto3.resource("dynamodb").Table(CONVERSATIONS_TABLE)
    if CONVERSATIONS_TABLE
    else None
)

# C8: Cognito user/group management.
USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID", "")
_cognito = boto3.client("cognito-idp") if USER_POOL_ID else None
USERNAME_RE = re.compile(r"^[\w.@+\-]{1,128}$")
GROUP_RE = re.compile(r"^[\w.\-]{1,128}$")

AGENT_ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")
REQUIRED_FIELDS = ("agentId", "name", "systemPrompt", "modelId", "voiceId")
ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")

# C3: document management + KB re-ingestion.
DOCUMENTS_BUCKET = os.environ.get("DOCUMENTS_BUCKET", "")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "")
DATA_SOURCE_ID = os.environ.get("DATA_SOURCE_ID", "")

# Uploads are namespaced per agent so a shared KB can be filtered later.
DOC_KEY_RE = re.compile(r"^[\w.\- ()]{1,200}$")
PRESIGN_EXPIRY_SECONDS = 900  # 15 min

_s3 = boto3.client("s3")
_bedrock_agent = boto3.client("bedrock-agent")


def _agent_prefix(agent_id: str) -> str:
    return f"agents/{agent_id}/"


# --- helpers --------------------------------------------------------------
def _resp(status: int, body: dict | None = None):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        },
        "body": json.dumps(body) if body is not None else "",
    }


def _groups(event) -> list[str]:
    """Extract cognito:groups from the JWT claims the authorizer attached."""
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    except (KeyError, TypeError):
        return []
    raw = claims.get("cognito:groups", "")
    if isinstance(raw, list):
        return raw
    # HTTP API flattens the claim to a string like "[admin]" or "admin".
    return [g for g in re.split(r"[\s,\[\]]+", str(raw)) if g]


def _is_admin(event) -> bool:
    return "admin" in _groups(event)


def _caller_sub(event) -> str:
    """C10: the authenticated user's Cognito sub from the JWT claims. Used by the
    /me endpoints so a user can only read their OWN conversations."""
    try:
        return event["requestContext"]["authorizer"]["jwt"]["claims"].get("sub", "")
    except (KeyError, TypeError):
        return ""


def _validate(body: dict, *, require_id: bool) -> str | None:
    for f in REQUIRED_FIELDS:
        if f == "agentId" and not require_id:
            continue
        if not body.get(f):
            return f"missing required field: {f}"
    if require_id and not AGENT_ID_RE.match(body.get("agentId", "")):
        return "agentId must match ^[a-z0-9-]{1,40}$"
    return None


def _to_item(body: dict, existing: dict | None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "agentId": body["agentId"],
        "name": body["name"],
        "description": body.get("description", ""),
        "systemPrompt": body["systemPrompt"],
        "modelId": body["modelId"],
        "voiceId": body["voiceId"],
        "knowledgeBaseIds": body.get("knowledgeBaseIds", []) or [],
        "toolNames": body.get("toolNames", []) or [],
        "rememberConversations": bool(body.get("rememberConversations", False)),
        "allowedGroups": body.get("allowedGroups", []) or [],
        "enabled": bool(body.get("enabled", True)),
        "createdAt": (existing or {}).get("createdAt", now),
        "updatedAt": now,
    }


# --- routing --------------------------------------------------------------
def handler(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    if method == "OPTIONS":
        return _resp(204)

    path_params = event.get("pathParameters") or {}
    agent_id = path_params.get("agentId")
    # routeKey looks like "POST /agents/{agentId}/documents"; use it to tell the
    # document/reindex routes apart from the plain CRUD routes.
    route_key = event.get("routeKey", "")

    is_write = method in ("POST", "PUT", "DELETE")
    if is_write and not _is_admin(event):
        return _resp(403, {"message": "admin group required"})

    try:
        # --- C3 document management routes ---
        if "/documents" in route_key:
            if method == "GET":
                return _list_documents(agent_id)
            if method == "POST":
                return _presign_upload(agent_id, _parse_body(event))
            if method == "DELETE":
                return _delete_document(agent_id, path_params.get("key"))
        if "/reindex" in route_key:
            if method == "POST":
                return _reindex()

        # --- C10 own conversation history (any authenticated user) ---
        # Must be checked BEFORE the admin /conversations block since the string
        # "/conversations" also appears in "/me/conversations".
        if "/me/conversations" in route_key:
            sub = _caller_sub(event)
            if not sub:
                return _resp(401, {"message": "unauthenticated"})
            agent_id = path_params.get("agentId")
            if agent_id:
                return _get_conversation(sub, agent_id)
            return _list_conversations(sub)

        # --- C7 conversation history (read-only, admin only) ---
        if "/conversations" in route_key:
            if not _is_admin(event):
                return _resp(403, {"message": "admin group required"})
            if path_params.get("userSub") and path_params.get("agentId"):
                return _get_conversation(
                    path_params["userSub"], path_params["agentId"]
                )
            return _list_conversations()

        # --- C8 user & group management (admin only) ---
        if "/users" in route_key or "/groups" in route_key:
            if not _is_admin(event):
                return _resp(403, {"message": "admin group required"})
            return _route_c8(method, route_key, path_params, event)

        # --- C2 agent CRUD routes ---
        if method == "GET" and agent_id:
            return _get_one(agent_id)
        if method == "GET":
            return _list()
        if method == "POST":
            return _create(_parse_body(event))
        if method == "PUT":
            return _put(agent_id, _parse_body(event))
        if method == "DELETE":
            return _delete(agent_id)
        return _resp(405, {"message": f"method not allowed: {method}"})
    except ValueError as exc:
        return _resp(400, {"message": str(exc)})
    except Exception as exc:  # pragma: no cover
        return _resp(500, {"message": f"internal error: {exc}"})


def _parse_body(event) -> dict:
    try:
        return json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        raise ValueError("invalid JSON body")


def _list():
    items = _table.scan().get("Items", [])
    items.sort(key=lambda a: a.get("agentId", ""))
    return _resp(200, {"agents": items})


def _get_one(agent_id: str):
    item = _table.get_item(Key={"agentId": agent_id}).get("Item")
    if not item:
        return _resp(404, {"message": "not found"})
    return _resp(200, item)


def _create(body: dict):
    err = _validate(body, require_id=True)
    if err:
        raise ValueError(err)
    existing = _table.get_item(Key={"agentId": body["agentId"]}).get("Item")
    if existing:
        return _resp(409, {"message": "agentId already exists"})
    item = _to_item(body, None)
    _table.put_item(Item=item)
    return _resp(201, item)


def _put(agent_id: str, body: dict):
    if not agent_id:
        raise ValueError("missing agentId in path")
    body["agentId"] = agent_id  # path wins
    err = _validate(body, require_id=True)
    if err:
        raise ValueError(err)
    existing = _table.get_item(Key={"agentId": agent_id}).get("Item")
    item = _to_item(body, existing)
    _table.put_item(Item=item)
    return _resp(200, item)


def _delete(agent_id: str):
    if not agent_id:
        raise ValueError("missing agentId in path")
    _table.delete_item(Key={"agentId": agent_id})
    return _resp(204)


# --- C3: document management + KB re-ingestion ----------------------------
def _require_bucket():
    if not DOCUMENTS_BUCKET:
        raise ValueError("documents bucket not configured")


def _list_documents(agent_id: str):
    if not agent_id:
        raise ValueError("missing agentId in path")
    _require_bucket()
    prefix = _agent_prefix(agent_id)
    resp = _s3.list_objects_v2(Bucket=DOCUMENTS_BUCKET, Prefix=prefix)
    docs = []
    for obj in resp.get("Contents", []):
        key = obj["Key"]
        name = key[len(prefix):]
        if not name:  # skip the folder placeholder, if any
            continue
        docs.append(
            {
                "key": name,
                "size": int(obj.get("Size", 0)),
                "lastModified": obj["LastModified"].isoformat()
                if obj.get("LastModified")
                else None,
            }
        )
    docs.sort(key=lambda d: d["key"])
    return _resp(200, {"documents": docs})


def _presign_upload(agent_id: str, body: dict):
    if not agent_id:
        raise ValueError("missing agentId in path")
    _require_bucket()
    filename = (body.get("filename") or "").strip()
    if not DOC_KEY_RE.match(filename):
        raise ValueError(
            "filename must be 1-200 chars of letters, numbers, space . - ( )"
        )
    content_type = body.get("contentType") or "application/octet-stream"
    key = _agent_prefix(agent_id) + filename
    url = _s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": DOCUMENTS_BUCKET,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=PRESIGN_EXPIRY_SECONDS,
    )
    return _resp(200, {"uploadUrl": url, "key": filename, "contentType": content_type})


def _delete_document(agent_id: str, key: str | None):
    if not agent_id:
        raise ValueError("missing agentId in path")
    if not key:
        raise ValueError("missing document key in path")
    _require_bucket()
    name = unquote(key)
    if not DOC_KEY_RE.match(name):
        raise ValueError("invalid document key")
    _s3.delete_object(Bucket=DOCUMENTS_BUCKET, Key=_agent_prefix(agent_id) + name)
    return _resp(204)


def _reindex():
    if not KNOWLEDGE_BASE_ID or not DATA_SOURCE_ID:
        raise ValueError("knowledge base not configured")
    resp = _bedrock_agent.start_ingestion_job(
        knowledgeBaseId=KNOWLEDGE_BASE_ID,
        dataSourceId=DATA_SOURCE_ID,
    )
    job = resp.get("ingestionJob", {})
    return _resp(
        202,
        {
            "ingestionJobId": job.get("ingestionJobId"),
            "status": job.get("status"),
        },
    )


# --- C7: read-only conversation history -----------------------------------
def _list_conversations(only_sub: str = ""):
    """Return a lightweight index of recent conversations.

    The Conversations table stores one item per turn (PK userSub, SK
    {agentId}#{ts}#{seq}). With `only_sub` set (C10 /me), we query just that
    user's items so a user sees ONLY their own. Without it (C7 admin), we scan a
    bounded page across all users. POC-scale index, not a full query engine.
    """
    if _conversations is None:
        raise ValueError("conversations table not configured")
    if only_sub:
        resp = _conversations.query(
            KeyConditionExpression=Key("userSub").eq(only_sub), Limit=500
        )
    else:
        resp = _conversations.scan(Limit=500)
    convos: dict = {}
    for it in resp.get("Items", []):
        user_sub = it.get("userSub", "")
        sk = it.get("sk", "")
        agent_id = sk.split("#", 1)[0] if "#" in sk else sk
        key = f"{user_sub}|{agent_id}"
        created = it.get("createdAt", "")

        # Stats items (written by session.py on close) carry token usage.
        # SK pattern: {agentId}#stats#{sessionId}
        is_stats = "#stats#" in sk
        if is_stats:
            entry = convos.setdefault(key, {
                "userSub": user_sub, "agentId": agent_id,
                "turns": 0, "lastActivity": created,
                "inputTokens": 0, "outputTokens": 0,
            })
            entry["inputTokens"] = entry.get("inputTokens", 0) + int(it.get("inputTokens", 0))
            entry["outputTokens"] = entry.get("outputTokens", 0) + int(it.get("outputTokens", 0))
            if created > entry["lastActivity"]:
                entry["lastActivity"] = created
            continue

        entry = convos.get(key)
        if entry is None:
            convos[key] = {
                "userSub": user_sub,
                "agentId": agent_id,
                "turns": 1,
                "lastActivity": created,
                "inputTokens": 0,
                "outputTokens": 0,
            }
        else:
            entry["turns"] += 1
            if created > entry["lastActivity"]:
                entry["lastActivity"] = created
    items = sorted(
        convos.values(), key=lambda c: c["lastActivity"], reverse=True
    )
    return _resp(200, {"conversations": items})


def _get_conversation(user_sub: str, agent_id: str):
    """Return the turns of one (userSub, agentId) conversation, oldest first."""
    if _conversations is None:
        raise ValueError("conversations table not configured")
    resp = _conversations.query(
        KeyConditionExpression=Key("userSub").eq(user_sub)
        & Key("sk").begins_with(f"{agent_id}#"),
        ScanIndexForward=True,  # oldest first
        Limit=200,
    )
    turns = [
        {
            "role": it.get("role", ""),
            "text": it.get("text", ""),
            "createdAt": it.get("createdAt", ""),
            "sessionId": it.get("sessionId", ""),
        }
        for it in resp.get("Items", [])
    ]
    return _resp(200, {"userSub": user_sub, "agentId": agent_id, "turns": turns})


# --- C8: user & group management (Cognito admin API) ----------------------
def _require_cognito():
    if _cognito is None or not USER_POOL_ID:
        raise ValueError("Cognito user pool not configured")


def _route_c8(method, route_key, path_params, event):
    _require_cognito()
    username = path_params.get("username")
    group = path_params.get("group")

    # /groups
    if route_key.endswith("/groups") and "{username}" not in route_key:
        if method == "GET":
            return _list_groups()
        if method == "POST":
            return _create_group(_parse_body(event))

    # /users/{username}/groups  and  /users/{username}/groups/{group}
    if "/users/{username}/groups" in route_key:
        if method == "POST":
            return _add_user_to_group(username, _parse_body(event))
        if method == "DELETE":
            return _remove_user_from_group(username, group)

    # /users/{username}/disable | /enable
    if route_key.endswith("/disable") and method == "POST":
        return _set_user_enabled(username, False)
    if route_key.endswith("/enable") and method == "POST":
        return _set_user_enabled(username, True)

    # /users
    if route_key.endswith("/users"):
        if method == "GET":
            return _list_users()
        if method == "POST":
            return _create_user(_parse_body(event))

    return _resp(404, {"message": "unknown route"})


def _attr(attrs, name):
    for a in attrs or []:
        if a.get("Name") == name:
            return a.get("Value")
    return None


def _list_users():
    resp = _cognito.list_users(UserPoolId=USER_POOL_ID, Limit=60)
    users = []
    for u in resp.get("Users", []):
        uname = u.get("Username", "")
        try:
            groups_resp = _cognito.admin_list_groups_for_user(
                UserPoolId=USER_POOL_ID, Username=uname, Limit=60
            )
            groups = [g.get("GroupName") for g in groups_resp.get("Groups", [])]
        except Exception:
            groups = []
        users.append(
            {
                "username": uname,
                "email": _attr(u.get("Attributes"), "email"),
                "enabled": u.get("Enabled", True),
                "status": u.get("UserStatus"),
                "groups": groups,
            }
        )
    users.sort(key=lambda x: (x.get("email") or x.get("username") or ""))
    return _resp(200, {"users": users})


def _create_user(body):
    email = (body.get("email") or "").strip()
    if not email or "@" not in email:
        raise ValueError("valid email required")
    resp = _cognito.admin_create_user(
        UserPoolId=USER_POOL_ID,
        Username=email,
        UserAttributes=[
            {"Name": "email", "Value": email},
            {"Name": "email_verified", "Value": "true"},
        ],
        DesiredDeliveryMediums=["EMAIL"],
    )
    u = resp.get("User", {})
    return _resp(
        201,
        {"username": u.get("Username"), "status": u.get("UserStatus")},
    )


def _set_user_enabled(username, enabled):
    if not username or not USERNAME_RE.match(username):
        raise ValueError("invalid username")
    if enabled:
        _cognito.admin_enable_user(UserPoolId=USER_POOL_ID, Username=username)
    else:
        _cognito.admin_disable_user(UserPoolId=USER_POOL_ID, Username=username)
    return _resp(200, {"username": username, "enabled": enabled})


def _list_groups():
    resp = _cognito.list_groups(UserPoolId=USER_POOL_ID, Limit=60)
    groups = [
        {"name": g.get("GroupName"), "description": g.get("Description", "")}
        for g in resp.get("Groups", [])
    ]
    groups.sort(key=lambda x: x["name"] or "")
    return _resp(200, {"groups": groups})


def _create_group(body):
    name = (body.get("name") or "").strip()
    if not GROUP_RE.match(name):
        raise ValueError("invalid group name")
    _cognito.create_group(
        UserPoolId=USER_POOL_ID,
        GroupName=name,
        Description=body.get("description", "")[:2048],
    )
    return _resp(201, {"name": name})


def _add_user_to_group(username, body):
    group = (body.get("group") or "").strip()
    if not username or not USERNAME_RE.match(username):
        raise ValueError("invalid username")
    if not GROUP_RE.match(group):
        raise ValueError("invalid group name")
    _cognito.admin_add_user_to_group(
        UserPoolId=USER_POOL_ID, Username=username, GroupName=group
    )
    return _resp(200, {"username": username, "group": group})


def _remove_user_from_group(username, group):
    if not username or not USERNAME_RE.match(username):
        raise ValueError("invalid username")
    if not group or not GROUP_RE.match(group):
        raise ValueError("invalid group name")
    _cognito.admin_remove_user_from_group(
        UserPoolId=USER_POOL_ID, Username=username, GroupName=unquote(group)
    )
    return _resp(204)
