import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3vectors from "aws-cdk-lib/aws-s3vectors";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

interface KnowledgeStackProps extends cdk.StackProps {
  envName: string;
}

/**
 * C3 Knowledge Base + RAG, built on Amazon Bedrock Knowledge Bases with an
 * Amazon S3 Vectors vector store (managed ingestion, low cost, no OpenSearch
 * floor).
 *
 * Resources:
 *  - documents S3 bucket (admin uploads here under agents/{agentId}/)
 *  - S3 Vectors bucket + index (stores embeddings)
 *  - Bedrock KB (VECTOR, Titan Text Embeddings v2) using the S3 Vectors index
 *  - Bedrock KB data source pointing at the documents bucket
 *  - KB service role with the required S3 / S3 Vectors / Bedrock permissions
 *
 * NOTE: S3 Vectors + Bedrock KB is new (2025); these are L1 (Cfn*) constructs.
 */
export class KnowledgeStack extends cdk.Stack {
  public readonly documentsBucket: s3.Bucket;
  public readonly knowledgeBaseId: string;
  public readonly dataSourceId: string;

  constructor(scope: Construct, id: string, props: KnowledgeStackProps) {
    super(scope, id, props);

    const removal =
      props.envName === "prod"
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;

    // Titan Text Embeddings v2 -> 1024 dims.
    const embeddingModelArn = `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`;
    const INDEX_NAME = "agents-kb-index";

    // --- Documents bucket (source data) ---
    this.documentsBucket = new s3.Bucket(this, "DocumentsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          // Allow the SPA to PUT documents via presigned URLs.
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
      removalPolicy: removal,
      autoDeleteObjects: props.envName !== "prod",
    });

    // --- S3 Vectors bucket + index (embedding store) ---
    // S3 Vectors bucket names must be globally unique, lowercase, 3-63 chars.
    // An auto-generated name blows past the 63-char limit, so we set an
    // explicit short name (account+region keep it unique, well under 63).
    const vectorBucketName = `phase0-${props.envName}-kbvec-${this.account}-${this.region}`;

    const vectorBucket = new s3vectors.CfnVectorBucket(this, "VectorBucket", {
      vectorBucketName,
    });

    const vectorIndex = new s3vectors.CfnIndex(this, "VectorIndex", {
      indexName: INDEX_NAME,
      vectorBucketName, // reference the explicit name (not the long auto ref)
      dataType: "float32",
      dimension: 1024, // Titan Text Embeddings v2
      distanceMetric: "cosine",
      metadataConfiguration: {
        // Bedrock stores the source chunk text under this key; it must be
        // non-filterable in S3 Vectors.
        nonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT"],
      },
    });
    vectorIndex.addDependency(vectorBucket);

    // --- KB service role ---
    const kbRole = new iam.Role(this, "KbServiceRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
    });
    kbRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [embeddingModelArn],
      })
    );
    this.documentsBucket.grantRead(kbRole);
    // S3 Vectors permissions for the KB to read/write the index.
    kbRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3vectors:GetIndex",
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:QueryVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:ListVectors",
        ],
        resources: ["*"],
      })
    );

    // --- Bedrock Knowledge Base (VECTOR, S3 Vectors store) ---
    const kb = new bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
      name: `phase0-${props.envName}-kb`,
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
        },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: {
          vectorBucketArn: vectorBucket.attrVectorBucketArn,
          indexName: INDEX_NAME,
        },
      },
    });
    kb.addDependency(vectorIndex);
    // The KB references the role by ARN (a string), so CloudFormation does NOT
    // automatically wait for the role's inline policy to be attached before it
    // validates the storage config (which calls s3vectors:QueryVectors +
    // bedrock:InvokeModel using the role). Add an explicit construct dependency
    // so the KbServiceRole DefaultPolicy is created BEFORE the knowledge base.
    kb.node.addDependency(kbRole);

    // --- Data source: the documents bucket ---
    const ds = new bedrock.CfnDataSource(this, "DocsDataSource", {
      name: "documents",
      knowledgeBaseId: kb.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: this.documentsBucket.bucketArn,
        },
      },
    });

    this.knowledgeBaseId = kb.attrKnowledgeBaseId;
    this.dataSourceId = ds.attrDataSourceId;

    new cdk.CfnOutput(this, "KnowledgeBaseId", { value: this.knowledgeBaseId });
    new cdk.CfnOutput(this, "DataSourceId", { value: this.dataSourceId });
    new cdk.CfnOutput(this, "DocumentsBucketName", {
      value: this.documentsBucket.bucketName,
    });
  }
}
