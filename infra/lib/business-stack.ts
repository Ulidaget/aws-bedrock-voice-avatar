import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import * as path from "path";

interface BusinessStackProps extends cdk.StackProps {
  envName: string;
}

/**
 * C9 business services: a simulated "order service" the voice agent can call.
 *
 * - `Orders` DynamoDB table (PK orderId).
 * - `OrderServiceFn` Lambda that owns order lookups (read-only on Orders).
 *
 * The voice proxy's `get_order_status` tool invokes this Lambda; the agent never
 * touches DynamoDB directly (realistic microservice integration pattern).
 */
export class BusinessStack extends cdk.Stack {
  public readonly ordersTable: dynamodb.Table;
  public readonly orderServiceFn: lambda.Function;

  constructor(scope: Construct, id: string, props: BusinessStackProps) {
    super(scope, id, props);

    this.ordersTable = new dynamodb.Table(this, "OrdersTable", {
      partitionKey: { name: "orderId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        props.envName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    this.orderServiceFn = new lambda.Function(this, "OrderServiceFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "..", "backend", "order_service")
      ),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        ORDERS_TABLE: this.ordersTable.tableName,
      },
    });
    this.ordersTable.grantReadData(this.orderServiceFn);

    new cdk.CfnOutput(this, "OrdersTableName", {
      value: this.ordersTable.tableName,
    });
    new cdk.CfnOutput(this, "OrderServiceFunctionName", {
      value: this.orderServiceFn.functionName,
    });
  }
}
