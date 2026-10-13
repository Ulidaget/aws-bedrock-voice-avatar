import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";

interface ObservabilityStackProps extends cdk.StackProps {
  service: ecs.FargateService;
}

/** CloudWatch dashboard + alarms for the voice POC custom metrics. */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const namespace = "Phase0VoicePOC";

    const metric = (name: string, stat = "Average", unit?: cloudwatch.Unit) =>
      new cloudwatch.Metric({
        namespace,
        metricName: name,
        statistic: stat,
        unit,
        period: cdk.Duration.minutes(1),
      });

    const timeToFirstAudio = metric("TimeToFirstAudio", "p95");
    const endToEnd = metric("EndToEndTurnLatency", "p95");
    const errors = metric("ConnectionErrors", "Sum", cloudwatch.Unit.COUNT);
    const interruptions = metric("Interruptions", "Sum", cloudwatch.Unit.COUNT);
    const turns = metric("TurnsPerSession", "Average", cloudwatch.Unit.COUNT);
    const duration = metric("SessionDuration", "Average");
    // C7: tool usage (function calling).
    const toolInvocations = metric(
      "ToolInvocations",
      "Sum",
      cloudwatch.Unit.COUNT
    );

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: `${cdk.Stack.of(this).stackName}-voice`,
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Latency (p95)",
        left: [timeToFirstAudio, endToEnd],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Errors & Interruptions",
        left: [errors, interruptions],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Session shape",
        left: [turns, duration],
        width: 12,
      }),
      // C7: tool usage (function calling) over time.
      new cloudwatch.GraphWidget({
        title: "Tool usage (C5)",
        left: [toolInvocations],
        width: 12,
      })
    );

    // Alarm on elevated time-to-first-audio (perceived latency).
    new cloudwatch.Alarm(this, "HighTimeToFirstAudio", {
      metric: timeToFirstAudio,
      threshold: 2000, // ms — tune after measuring in-region
      evaluationPeriods: 3,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm on connection error spikes.
    new cloudwatch.Alarm(this, "ConnectionErrorSpike", {
      metric: errors,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
