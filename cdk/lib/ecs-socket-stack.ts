import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cdk from "aws-cdk-lib";
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

    const vpc = vpcStack.vpc;

    const cluster = new ecs.Cluster(this, "SocketCluster", { vpc });

    const taskRole = new iam.Role(this, "SocketTaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        ),
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
                "bedrock:ConverseStream",
                "bedrock:InvokeModelWithResponseStream",
              ],
              resources: ["*"],
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["sts:AssumeRole", "sts:GetCallerIdentity"],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    const taskDef = new ecs.FargateTaskDefinition(this, "SocketTaskDef", {
      cpu: 1024, // Doubled CPU for better performance
      memoryLimitMiB: 2048, // Doubled memory for better stability
      taskRole,
      executionRole: taskRole,
    });

    const container = taskDef.addContainer("SocketContainer", {
      image: ecs.ContainerImage.fromAsset("./socket-server"),
      portMappings: [{ containerPort: 443 }], // Match the HTTPS server port
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "Socket",
        logRetention: 7, // Keep logs for 7 days for troubleshooting
      }),
      environment: {
        NODE_ENV: "production",
      },
    });

    const service = new ecs.FargateService(this, "SocketService", {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, "SocketNLB", {
      vpc,
      internetFacing: true,
    });

    const listener = nlb.addListener("TcpListener", {
      port: 443,
      protocol: elbv2.Protocol.TCP, // TCP passthrough for TLS
    });

    listener.addTargets("EcsTargetGroup", {
      port: 443,
      protocol: elbv2.Protocol.TCP,
      targets: [service],
      healthCheck: {
        protocol: elbv2.Protocol.TCP, // TCP health check only
        port: "443",
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 10, // More tolerance for startup issues
        interval: cdk.Duration.seconds(120), // Much longer interval between checks
        timeout: cdk.Duration.seconds(60), // Extended timeout
      },
    });

    this.socketUrl = `wss://${nlb.loadBalancerDnsName}`;

    new CfnOutput(this, "SocketUrl", {
      value: this.socketUrl,
      description: "WebSocket server URL via NLB TCP passthrough with TLS",
      exportName: `${id}-SocketUrl`,
    });
  }
}
