#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { NetworkStack } from "../lib/network-stack";
import { AuthStack } from "../lib/auth-stack";
import { DataStack } from "../lib/data-stack";
import { KnowledgeStack } from "../lib/knowledge-stack";
import { BusinessStack } from "../lib/business-stack";
import { BackendStack } from "../lib/backend-stack";
import { AdminStack } from "../lib/admin-stack";
import { FrontendStack } from "../lib/frontend-stack";
import { ObservabilityStack } from "../lib/observability-stack";

const app = new cdk.App();

// Environment name from `-c env=dev|test|prod` (default dev).
const envName = (app.node.tryGetContext("env") as string) ?? "dev";

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const prefix = `Phase0-${envName}`;
const tags = { Project: "phase0-voice-avatar-poc", Environment: envName };

const network = new NetworkStack(app, `${prefix}-Network`, { env, tags });

const auth = new AuthStack(app, `${prefix}-Auth`, {
  env,
  tags,
  envName,
});

const data = new DataStack(app, `${prefix}-Data`, {
  env,
  tags,
  envName,
});

const knowledge = new KnowledgeStack(app, `${prefix}-Knowledge`, {
  env,
  tags,
  envName,
});

const business = new BusinessStack(app, `${prefix}-Business`, {
  env,
  tags,
  envName,
});

const backend = new BackendStack(app, `${prefix}-Backend`, {
  env,
  tags,
  envName,
  vpc: network.vpc,
  userPool: auth.userPool,
  agentsTable: data.agentsTable,
  conversationsTable: data.conversationsTable,
  knowledgeBaseId: knowledge.knowledgeBaseId,
  orderServiceFn: business.orderServiceFn,
});

const admin = new AdminStack(app, `${prefix}-Admin`, {
  env,
  tags,
  envName,
  agentsTable: data.agentsTable,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  documentsBucket: knowledge.documentsBucket,
  knowledgeBaseId: knowledge.knowledgeBaseId,
  dataSourceId: knowledge.dataSourceId,
  conversationsTable: data.conversationsTable,
});

new FrontendStack(app, `${prefix}-Frontend`, {
  env,
  tags,
  envName,
  loadBalancer: backend.loadBalancer,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  cognitoDomainPrefix: auth.domainPrefix,
  adminApiUrl: admin.apiUrl,
});

new ObservabilityStack(app, `${prefix}-Observability`, {
  env,
  tags,
  service: backend.service,
});

app.synth();
