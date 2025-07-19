import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import { VpcStack } from "./vpc-stack";

export interface EcsSocketStackProps extends StackProps {
  domainName?: string;
  certificateArn?: string;
  hostedZoneId?: string;
  createDnsRecord?: boolean;
}

export class EcsSocketStack extends Stack {
  public readonly socketUrl: string;
  public readonly secureSocketUrl: string;

  constructor(
    scope: Construct,
    id: string,
    vpcStack: VpcStack,
    props?: EcsSocketStackProps
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
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "ssmmessages:CreateControlChannel",
                "ssmmessages:CreateDataChannel",
                "ssmmessages:OpenControlChannel",
                "ssmmessages:OpenDataChannel",
              ],
              resources: ["*"],
            }),
          ],
        }),
      },
    });

    // Enable execute command on cluster
    cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      minCapacity: 0,
      maxCapacity: 0,
    });

    // Set up certificate if provided
    let certificate;
    if (props?.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(
        this,
        "Certificate",
        props.certificateArn
      );
    }

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
          listenerPort: 443,
          protocol: certificate ? elbv2.ApplicationProtocol.HTTPS : elbv2.ApplicationProtocol.HTTP,
          certificate: certificate,
          redirectHTTP: certificate ? true : false,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset("./socket-server"),
            containerPort: 3000,
            taskRole: taskRole,
            executionRole: taskRole,
          },
          publicLoadBalancer: true,
          enableExecuteCommand: true,
        }
      );

    // Configure for WebSocket support
    fargateService.targetGroup.configureHealthCheck({
      path: "/health",
      port: "3000",
      healthyHttpCodes: "200,404",
      interval: Duration.seconds(30),
      timeout: Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
    });

    // Enable sticky sessions for WebSocket
    fargateService.targetGroup.setAttribute("stickiness.enabled", "true");
    fargateService.targetGroup.setAttribute("stickiness.type", "lb_cookie");

    // Create DNS record if domain name and hosted zone ID are provided
    if (props?.domainName && props?.hostedZoneId && props?.createDnsRecord) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: props.hostedZoneId,
        zoneName: props.domainName.split('.').slice(-2).join('.')
      });

      new route53.ARecord(this, 'SocketDnsRecord', {
        zone: hostedZone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new targets.LoadBalancerTarget(fargateService.loadBalancer)
        ),
      });

      this.socketUrl = `http://${props.domainName}`;
      this.secureSocketUrl = `https://${props.domainName}`;
    } else {
      this.socketUrl = `http://${fargateService.loadBalancer.loadBalancerDnsName}`;
      this.secureSocketUrl = certificate 
        ? `https://${fargateService.loadBalancer.loadBalancerDnsName}` 
        : this.socketUrl;
    }

    // Export the socket URLs
    new cdk.CfnOutput(this, "SocketUrl", {
      value: this.socketUrl,
      description: "Socket.IO server HTTP URL",
      exportName: `${id}-SocketUrl`,
    });
    
    new cdk.CfnOutput(this, "SecureSocketUrl", {
      value: this.secureSocketUrl,
      description: "Socket.IO server HTTPS URL",
      exportName: `${id}-SecureSocketUrl`,
    });
  }
}
