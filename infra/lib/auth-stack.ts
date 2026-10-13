import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

interface AuthStackProps extends cdk.StackProps {
  envName: string;
}

/**
 * Cognito User Pool + Hosted UI domain + app client + admin group.
 *
 * C2 note: the app client now lives HERE (not in FrontendStack) so both the
 * AdminStack (JWT authorizer audience) and the FrontendStack (config.json) can
 * consume its id without creating a stack dependency cycle.
 *
 * The OAuth callback/logout URLs include localhost plus a wildcard-ish set; the
 * exact CloudFront URL is added post-deploy with a documented one-time
 * `aws cognito-idp update-user-pool-client` command (the CloudFront domain is
 * not known at Auth synth time). Implicit-grant redirect must match exactly.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly domainPrefix: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `phase0-${props.envName}`,
      selfSignUpEnabled: false, // admin-created users for the POC
      signInAliases: { email: true },
      passwordPolicy: { minLength: 8, requireDigits: true, requireLowercase: true },
      removalPolicy:
        props.envName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    // Hosted UI domain (must be globally unique per region).
    this.domainPrefix = `phase0-${props.envName}-${this.account}`.slice(0, 63);
    this.userPool.addDomain("HostedUiDomain", {
      cognitoDomain: { domainPrefix: this.domainPrefix },
    });

    // Public SPA app client. Callback URLs start with localhost; the CloudFront
    // URL is added post-deploy (see README) because it isn't known here.
    this.userPoolClient = new cognito.UserPoolClient(this, "WebClient", {
      userPool: this.userPool,
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { implicitCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: ["http://localhost:5173"],
        logoutUrls: ["http://localhost:5173"],
      },
    });

    // C2: admin group. Members may mutate agents via the admin API.
    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "admin",
      description: "Platform administrators (agent CRUD).",
    });

    new cdk.CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
    });
  }
}
