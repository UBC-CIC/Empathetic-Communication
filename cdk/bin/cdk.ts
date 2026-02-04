#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AmplifyStack } from "../lib/amplify-stack";
import { ApiServiceStack } from "../lib/api-service-stack";
import { CICDStack } from "../lib/cicd-stack";
import { DatabaseStack } from "../lib/database-stack";
import { DBFlowStack } from "../lib/dbFlow-stack";
import { VpcStack } from "../lib/vpc-stack";
import { EcsSocketStack } from "../lib/ecs-socket-stack";
const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const StackPrefix = app.node.tryGetContext("StackPrefix");
const environment = app.node.tryGetContext("environment");
const githubRepo = app.node.tryGetContext("githubRepo");
const githubBranch = app.node.tryGetContext("githubBranch") || "main";

const vpcStack = new VpcStack(app, `${StackPrefix}-VpcStack`, { env });
const dbStack = new DatabaseStack(app, `${StackPrefix}-Database`, vpcStack, {
  env,
});
const apiStack = new ApiServiceStack(
  app,
  `${StackPrefix}-Api`,
  dbStack,
  vpcStack,
  null, // ecsSocketStack will be passed later
  { env }
);
// Defining the new CI/CD Stack
const cicdStack = new CICDStack(app, `${StackPrefix}-CICD`, {
  env,
  githubRepo: githubRepo,
  githubBranch: githubBranch,
  environmentName: environment,
  lambdaFunctions: [
    {
      name: "TextGen",
      functionName: `${StackPrefix}-Api-TextGenLambdaDockerFunction`,
      sourceDir: "cdk/text_generation",
    },
    {
      name: "DataIngestion",
      functionName: `${StackPrefix}-Api-DataIngestLambdaDockerFunction`,
      sourceDir: "cdk/data_ingestion",
    },
  ],
});
const ecsSocketStack = new EcsSocketStack(
  app,
  `${StackPrefix}-EcsSocket`,
  vpcStack,
  dbStack,
  apiStack,
  { env }
);
const dbFlowStack = new DBFlowStack(
  app,
  `${StackPrefix}-DBFlow`,
  vpcStack,
  dbStack,
  apiStack,
  { env }
);

const amplifyStack = new AmplifyStack(
  app,
  `${StackPrefix}-Amplify`,
  apiStack,
  ecsSocketStack,
  apiStack, // Pass apiStack instead of appSyncStack since AppSync is now part of it
  {
    env,
  }
);
cdk.Tags.of(app).add("app", "Virtual-Care-Interaction");
