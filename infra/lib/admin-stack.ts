import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2_auth from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwv2_int from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import * as path from "path";

interface AdminStackProps extends cdk.StackProps {
  envName: string;
  agentsTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  documentsBucket: s3.IBucket;
  knowledgeBaseId: string;
  dataSourceId: string;
  conversationsTable: dynamodb.ITable;
}

/**
 * C2 Admin API: HTTP API Gateway + Lambda CRUD over the Agents table, protected
 * by a Cognito JWT authorizer. The Lambda additionally enforces the `admin`
 * group for mutations. Depends only on Auth (pool + client for the authorizer)
 * and Data (table) — no Frontend/Backend edges, so the stack graph stays acyclic.
 */
export class AdminStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: AdminStackProps) {
    super(scope, id, props);

    const fn = new lambda.Function(this, "AdminCrudFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "..", "backend", "admin")
      ),
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        AGENTS_TABLE: props.agentsTable.tableName,
        // CORS is echoed by the Lambda too; "*" is fine for a POC. Tighten to
        // the CloudFront origin later (would add a Frontend dependency).
        ALLOWED_ORIGIN: "*",
        // C3: documents bucket + KB for document management & re-indexing.
        DOCUMENTS_BUCKET: props.documentsBucket.bucketName,
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
        DATA_SOURCE_ID: props.dataSourceId,
        // C7: read-only access to conversation transcripts for the admin panel.
        CONVERSATIONS_TABLE: props.conversationsTable.tableName,
        // C8: user & group management via the Cognito admin API.
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      },
    });
    props.agentsTable.grantReadWriteData(fn);
    // C7: the admin can READ conversations (never write them).
    props.conversationsTable.grantReadData(fn);

    // C8: manage Cognito users and groups, scoped to this user pool.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminEnableUser",
          "cognito-idp:ListGroups",
          "cognito-idp:CreateGroup",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminListGroupsForUser",
        ],
        resources: [props.userPool.userPoolArn],
      })
    );

    // C3: manage documents in S3 and trigger KB ingestion.
    props.documentsBucket.grantReadWrite(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:StartIngestionJob", "bedrock:GetIngestionJob"],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${props.knowledgeBaseId}`,
        ],
      })
    );

    // Cognito JWT authorizer: validates the id_token against the pool (issuer)
    // with the app client as the audience.
    const authorizer = new apigwv2_auth.HttpJwtAuthorizer(
      "CognitoJwt",
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.userPoolClient.userPoolClientId],
      }
    );

    const api = new apigwv2.HttpApi(this, "AdminApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["authorization", "content-type"],
      },
    });

    const integration = new apigwv2_int.HttpLambdaIntegration("AdminInt", fn);

    api.addRoutes({
      path: "/agents",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/agents/{agentId}",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.PUT,
        apigwv2.HttpMethod.DELETE,
      ],
      integration,
      authorizer,
    });

    // C3: document management for an agent's knowledge base.
    // POST -> presigned PUT URL; GET -> list documents under agents/{id}/.
    api.addRoutes({
      path: "/agents/{agentId}/documents",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });
    // DELETE a specific document by (url-encoded) key.
    api.addRoutes({
      path: "/agents/{agentId}/documents/{key}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration,
      authorizer,
    });
    // Trigger KB re-ingestion (StartIngestionJob).
    api.addRoutes({
      path: "/agents/{agentId}/reindex",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });

    // C7: read-only conversation history (admin-group enforced in the Lambda).
    api.addRoutes({
      path: "/conversations",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/conversations/{userSub}/{agentId}",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer,
    });

    // C10: the caller's OWN conversation history (any authenticated user; the
    // Lambda derives the user from the JWT sub claim, not a path param).
    api.addRoutes({
      path: "/me/conversations",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/me/conversations/{agentId}",
      methods: [apigwv2.HttpMethod.GET],
      integration,
      authorizer,
    });

    // C8: user & group management (admin-group enforced in the Lambda).
    api.addRoutes({
      path: "/users",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/users/{username}/disable",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/users/{username}/enable",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/users/{username}/groups",
      methods: [apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/users/{username}/groups/{group}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration,
      authorizer,
    });
    api.addRoutes({
      path: "/groups",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration,
      authorizer,
    });

    this.apiUrl = api.apiEndpoint;

    new cdk.CfnOutput(this, "AdminApiUrl", { value: api.apiEndpoint });
  }
}
