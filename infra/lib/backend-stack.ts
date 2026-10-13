import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import * as path from "path";

interface BackendStackProps extends cdk.StackProps {
  envName: string;
  vpc: ec2.Vpc;
  userPool: cognito.IUserPool;
  agentsTable: cdk.aws_dynamodb.ITable;
  conversationsTable: cdk.aws_dynamodb.ITable;
  knowledgeBaseId: string;
  orderServiceFn: cdk.aws_lambda.IFunction;
}

/**
 * Fargate WebSocket voice-proxy behind an ALB.
 * - Builds the backend container image from ../backend (Docker asset).
 * - Task role has LEAST-PRIVILEGE Bedrock access to the Nova Sonic model only.
 * - The browser never receives AWS credentials; the task role calls Bedrock.
 * - Validates the Cognito JWT against the User Pool (issuer + signature). The
 *   app-client id is not required here (the client lives in the FrontendStack),
 *   so there is no circular dependency.
 */
export class BackendStack extends cdk.Stack {
  public readonly service: ecs.FargateService;
  public readonly loadBalancer: cdk.aws_elasticloadbalancingv2.IApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props);

    const cluster = new ecs.Cluster(this, "Cluster", { vpc: props.vpc });

    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // Least-privilege: only the bidirectional-stream invoke on Nova Sonic models.
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModelWithBidirectionalStream",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:InvokeModel",
        ],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-2-sonic-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-sonic-v1:0`,
        ],
      })
    );

    // C1: least-privilege read access to the agents config table.
    props.agentsTable.grantReadData(taskRole);

    // C4: read + write conversational memory.
    props.conversationsTable.grantReadWriteData(taskRole);

    // C9: allow invoking the order-service business Lambda (get_order_status).
    props.orderServiceFn.grantInvoke(taskRole);

    // C3: allow retrieving from the knowledge base (RAG).
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:Retrieve"],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${props.knowledgeBaseId}`,
        ],
      })
    );

    const logGroup = new logs.LogGroup(this, "ServiceLogs", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy:
        props.envName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    const albService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "VoiceProxy",
      {
        cluster,
        cpu: 512,
        memoryLimitMiB: 1024,
        desiredCount: 1,
        circuitBreaker: { rollback: true }, // fail fast on bad deploys
        minHealthyPercent: 50,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(
            path.join(__dirname, "..", "..", "backend")
          ),
          containerPort: 8080,
          taskRole,
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: "voice-proxy",
            logGroup,
          }),
          environment: {
            AWS_REGION: this.region,
            BEDROCK_MODEL_ID: "amazon.nova-2-sonic-v1:0",
            COGNITO_USER_POOL_ID: props.userPool.userPoolId,
            // App-client id intentionally omitted; JWT is validated against the
            // pool (issuer + signature). Set later if you want strict aud check.
            AUTH_DISABLED: "false",
            PORT: "8080",
            MAX_SESSION_SECONDS: "450",
            // C1: DynamoDB agents table for the multi-agent config store.
            AGENTS_TABLE: props.agentsTable.tableName,
            // C3: knowledge base for RAG retrieval.
            KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
            // C4: conversational memory table.
            CONVERSATIONS_TABLE: props.conversationsTable.tableName,
            // C9: order-service business Lambda for the get_order_status tool.
            ORDER_SERVICE_FUNCTION: props.orderServiceFn.functionName,
          },
        },
        publicLoadBalancer: true,
        // Give the container time to cold-start (image pull + Python imports)
        // before the ALB starts failing health checks.
        healthCheckGracePeriod: cdk.Duration.seconds(120),
      }
    );

    // Health check hits a DEDICATED standard HTTP server on port 8081 (/health).
    // The WebSocket traffic stays on 8080. A plain HTTP server gives the ALB an
    // unambiguous 200 (the websockets process_request hook was unreliable behind
    // the ALB and caused Target.Timeout).
    albService.targetGroup.configureHealthCheck({
      port: "8081",
      path: "/health",
      healthyHttpCodes: "200",
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    // The L3 pattern auto-opens the task SG for the TRAFFIC port (8080) from the
    // ALB, but NOT for a different health-check port. Open 8081 explicitly from
    // the ALB's security group so the ALB can reach the dedicated health server.
    // NOTE: use loadBalancer.connections (an IConnectable) as the source, not the
    // load balancer object itself, so the ingress rule actually materializes.
    albService.service.connections.allowFrom(
      albService.loadBalancer.connections,
      ec2.Port.tcp(8081),
      "ALB health check to dedicated health port 8081"
    );

    // WebSocket needs long idle timeouts and sticky handling.
    albService.loadBalancer.setAttribute("idle_timeout.timeout_seconds", "600");

    this.service = albService.service;
    this.loadBalancer = albService.loadBalancer;

    new cdk.CfnOutput(this, "AlbDnsName", {
      value: albService.loadBalancer.loadBalancerDnsName,
      description:
        "Internal ALB DNS. The browser connects via CloudFront (wss://), not directly.",
    });
  }
}
