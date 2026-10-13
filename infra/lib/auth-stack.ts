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

    // Dark-theme CSS for the Cognito Hosted UI.
    new cognito.CfnUserPoolUICustomizationAttachment(this, "HostedUiCss", {
      userPoolId: this.userPool.userPoolId,
      clientId: "ALL",
      css: `
        .background-customizable {
          background: linear-gradient(145deg, #060d1f, #0f172a);
        }
        .modal-content {
          background-color: #0f172a;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.6);
        }
        .banner-customizable { background-color: transparent; }
        .textDescription-customizable {
          color: #e2e8f0;
          font-size: 18px;
          font-weight: 600;
        }
        .label-customizable {
          color: #94a3b8;
          font-weight: 500;
          font-size: 14px;
        }
        .inputField-customizable {
          background-color: #1e293b;
          border: 1px solid #334155;
          border-radius: 8px;
          color: #f1f5f9;
        }
        .inputField-customizable:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59,130,246,0.3);
          background-color: #1e293b;
        }
        .submitButton-customizable {
          background-color: #3b82f6;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 600;
        }
        .submitButton-customizable:hover { background-color: #2563eb; }
        .forgotPassword a, a { color: #3b82f6; }
        .errorMessage-customizable { color: #fca5a5; }
      `,
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
