import { Stack, StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import { VpcStack } from "./vpc-stack";

export class EcsSocketStack extends Stack {
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
            image: ecs.ContainerImage.fromAsset("."),
            containerPort: 3000,
          },
          publicLoadBalancer: true,
        }
      );

    // Optional: health check config
    fargateService.targetGroup.configureHealthCheck({
      path: "/",
      port: "3000",
      healthyHttpCodes: "200,404", // adapt to your server
    });
  }
}
