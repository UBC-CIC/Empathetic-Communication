import { Stack, StackProps, triggers } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { VpcStack } from "./vpc-stack";
import { DatabaseStack } from "./database-stack";
import { ApiServiceStack } from "./api-service-stack";

export class DBFlowStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    vpcStack: VpcStack,
    db: DatabaseStack,
    apiStack: ApiServiceStack,
    props?: StackProps
  ) {
    super(scope, id, props);

    // Create IAM role for Lambda within the VPC
    const lambdaRole = new iam.Role(this, `${id}-lambda-vpc-role`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Role for all Lambda functions inside VPC",
    });

    // Add necessary policies to the Lambda role
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          // Secrets Manager
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
        ],
        resources: [
          `arn:aws:secretsmanager:${this.region}:${this.account}:secret:*`,
        ],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          // CloudWatch Logs
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["arn:aws:logs:*:*:*"],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ec2:CreateNetworkInterface",
          "ec2:DeleteNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
        ],
        resources: ["*"],
      })
    );

    // Add additional managed policies
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMReadOnlyAccess")
    );

    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );

    // Create a Lambda layer for node-pg-migrate
    const nodePgMigrateLayer = new lambda.LayerVersion(
      this,
      "nodePgMigrateLayer",
      {
        code: lambda.Code.fromAsset("./layers/node-pg-migrate.zip"),
        compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
        description: "Lambda layer with node-pg-migrate and pg",
      }
    );

    new triggers.TriggerFunction(this, `${id}-triggerLambda`, {
      description: `Database initializer and migration runner - ${new Date().toISOString()}`,
      functionName: `${id}-initializerFunction`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      timeout: Duration.seconds(300),
      memorySize: 512,
      environment: {
        DB_SECRET_NAME: db.secretPathAdminName,
        DB_USER_SECRET_NAME: db.secretPathUser.secretName,
        DB_PROXY: db.secretPathTableCreator.secretName,
      },
      vpc: db.dbInstance.vpc,
      code: lambda.Code.fromAsset("lambda/db_setup"),
      layers: [nodePgMigrateLayer],
      role: lambdaRole,
    });
  }
}
