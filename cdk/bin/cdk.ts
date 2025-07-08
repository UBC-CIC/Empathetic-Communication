#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AmplifyStack } from "../lib/amplify-stack";
import { ApiGatewayStack } from "../lib/api-gateway-stack";
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

const vpcStack = new VpcStack(app, `${StackPrefix}-VpcStack`, { env });
const dbStack = new DatabaseStack(app, `${StackPrefix}-Database`, vpcStack, {
  env,
});
const ecsSocketStack = new EcsSocketStack(
  app,
  `${StackPrefix}-EcsSocket`,
  vpcStack,
  { env }
);
const apiStack = new ApiGatewayStack(
  app,
  `${StackPrefix}-Api`,
  dbStack,
  vpcStack,
  ecsSocketStack,
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
const amplifyStack = new AmplifyStack(app, `${StackPrefix}-Amplify`, apiStack, {
  env,
});
cdk.Tags.of(app).add("app", "Virtual-Care-Interaction");
