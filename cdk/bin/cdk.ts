#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AmplifyStack } from "../lib/amplify-stack";
import { ApiServiceStack } from "../lib/api-service-stack";

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
const apiStack = new ApiServiceStack(
  app,
  `${StackPrefix}-Api`,
  dbStack,
  vpcStack,
  null, // ecsSocketStack will be passed later
  { env }
);
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
