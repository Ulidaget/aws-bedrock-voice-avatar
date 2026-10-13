import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";

interface FrontendStackProps extends cdk.StackProps {
  envName: string;
  loadBalancer: elbv2.IApplicationLoadBalancer;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  cognitoDomainPrefix: string;
  adminApiUrl: string;
}

/**
 * Single CloudFront distribution that:
 *  - serves the SPA from a private S3 bucket (default behavior, OAC), and
 *  - reverse-proxies the WebSocket to the backend ALB under /ws* and /session*.
 *
 * Fronting the WebSocket with CloudFront gives us wss:// on the same HTTPS
 * origin as the SPA, avoiding mixed-content blocking without needing a custom
 * domain or ACM certificate.
 *
 * A runtime config.json is written to S3 with the real endpoint/Cognito values
 * so the same SPA build works in any environment.
 */
export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, "SpaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy:
        props.envName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.envName !== "prod",
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(bucket);

    // ALB origin for the WebSocket. CloudFront -> ALB is plain HTTP (inside AWS);
    // the browser -> CloudFront leg is HTTPS/WSS.
    const albOrigin = new origins.LoadBalancerV2Origin(props.loadBalancer, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      readTimeout: cdk.Duration.seconds(60),
      keepaliveTimeout: cdk.Duration.seconds(60),
    });

    // Behavior for the WebSocket: no caching, forward everything, allow all methods.
    const wsBehavior: cloudfront.BehaviorOptions = {
      origin: albOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
    };

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/session*": wsBehavior,
        "/ws*": wsBehavior,
        "/health*": wsBehavior,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    const spaUrl = `https://${distribution.distributionDomainName}`;

    // C2: the Cognito app client now lives in AuthStack (so AdminStack can use
    // its id for the JWT authorizer without a cycle). We just consume its id.
    // The client's OAuth callback URLs must include this CloudFront `spaUrl`;
    // that is set post-deploy via a documented one-time AWS CLI command (the
    // domain isn't known at Auth synth time). See README.

    // Runtime config consumed by the SPA at startup (/config.json).
    const runtimeConfig = {
      wssEndpoint: `wss://${distribution.distributionDomainName}/session`,
      authDisabled: false,
      cognito: {
        userPoolId: props.userPool.userPoolId,
        clientId: props.userPoolClient.userPoolClientId,
        domain: `${props.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`,
      },
      apiUrl: props.adminApiUrl,
      avatarModelUrl: "",
    };

    // Deploy the built SPA (if present) plus the runtime config.json.
    const distPath = path.join(__dirname, "..", "..", "frontend", "dist");
    const sources: s3deploy.ISource[] = [
      s3deploy.Source.jsonData("config.json", runtimeConfig),
    ];
    if (fs.existsSync(distPath)) {
      sources.unshift(s3deploy.Source.asset(distPath));
    } else {
      new cdk.CfnOutput(this, "BuildWarning", {
        value:
          "frontend/dist not found — run the frontend build before `cdk deploy`",
      });
    }

    new s3deploy.BucketDeployment(this, "DeploySpa", {
      sources,
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new cdk.CfnOutput(this, "SpaUrl", { value: spaUrl });
    new cdk.CfnOutput(this, "WssEndpoint", { value: runtimeConfig.wssEndpoint });
  }
}
