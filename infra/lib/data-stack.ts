import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

interface DataStackProps extends cdk.StackProps {
  envName: string;
}

/**
 * C1 multi-agent config store: a single DynamoDB table `Agents`.
 *
 * Each item maps 1:1 to the backend AgentConfig dataclass (agentId, name,
 * description, systemPrompt, modelId, voiceId, knowledgeBaseIds, toolNames,
 * enabled). On-demand billing (pay-per-request) is effectively free at POC
 * scale and needs no capacity planning.
 */
export class DataStack extends cdk.Stack {
  public readonly agentsTable: dynamodb.Table;
  public readonly conversationsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const removal =
      props.envName === "prod"
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;

    this.agentsTable = new dynamodb.Table(this, "AgentsTable", {
      partitionKey: { name: "agentId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removal,
      pointInTimeRecoverySpecification:
        props.envName === "prod"
          ? { pointInTimeRecoveryEnabled: true }
          : undefined,
    });

    new cdk.CfnOutput(this, "AgentsTableName", {
      value: this.agentsTable.tableName,
    });

    // C4 conversational memory: transcripts per user+agent, chronologically
    // ordered by the sort key, auto-expiring via the `ttl` attribute. Strictly
    // namespaced by userSub (partition key), so users never read each other's
    // memory.
    this.conversationsTable = new dynamodb.Table(this, "ConversationsTable", {
      partitionKey: { name: "userSub", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: removal,
      pointInTimeRecoverySpecification:
        props.envName === "prod"
          ? { pointInTimeRecoveryEnabled: true }
          : undefined,
    });

    new cdk.CfnOutput(this, "ConversationsTableName", {
      value: this.conversationsTable.tableName,
    });
  }
}
