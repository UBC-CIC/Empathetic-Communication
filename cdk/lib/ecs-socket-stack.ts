import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import { VpcStack } from "./vpc-stack";

export class EcsSocketStack extends Stack {
  public readonly socketUrl: string;

  constructor(
    scope: Construct,
    id: string,
    vpcStack: VpcStack,
    props?: StackProps
  ) {
    super(scope, id, props);

    // Create a VPC
    const vpc = vpcStack.vpc;

    // ECS cluster
    const cluster = new ecs.Cluster(this, "SocketCluster", { vpc });

    // Create task role with Bedrock permissions
    const taskRole = new iam.Role(this, "SocketTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy")
      ],
      inlinePolicies: {
        BedrockPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithBidirectionalStream",
                "bedrock:Converse",
                "bedrock:ConverseStream"
              ],
              resources: ["*"]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "ssmmessages:CreateControlChannel",
                "ssmmessages:CreateDataChannel",
                "ssmmessages:OpenControlChannel",
                "ssmmessages:OpenDataChannel"
              ],
              resources: ["*"]
            })
          ]
        })
      }
    });

    // Enable execute command on cluster
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      minCapacity: 0,
      maxCapacity: 0
    });

    // Fargate service with load balancer
    const fargateService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "SocketService",
        {
          cluster,
          cpu: 512,
          memoryLimitMiB: 1024,
          desiredCount: 1,
          listenerPort: 80,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset("./socket-server"),
            containerPort: 3000,
            taskRole: taskRole,
            executionRole: taskRole
          },
          publicLoadBalancer: true,
          enableExecuteCommand: true
        }
      );

    // Optional: health check config
    fargateService.targetGroup.configureHealthCheck({
      path: "/",
      port: "3000",
      healthyHttpCodes: "200,404", // adapt to your server
    });

    this.socketUrl = `http://${fargateService.loadBalancer.loadBalancerDnsName}`;

    // Export the socket URL
    new cdk.CfnOutput(this, "SocketUrl", {
      value: this.socketUrl,
      description: "Socket.IO server URL",
      exportName: `${id}-SocketUrl`,
    });
  }
}
