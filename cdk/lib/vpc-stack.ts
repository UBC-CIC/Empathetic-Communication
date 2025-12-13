import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Fn } from "aws-cdk-lib";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

export class VpcStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly vpcCidrString: string;
  public readonly privateSubnetsCidrStrings: string[];
  public readonly frontPrivateSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const existingVpcId: string = "vpc-025783243153bb54c"; // CHANGE IF DEPLOYING WITH EXISTING VPC

    if (existingVpcId !== "") {
      const AWSControlTowerStackSet =
        "ProvisionVPC"; // CHANGE TO YOUR CONTROL TOWER STACK SET
      
      // **IMPORTANT**: Replace these with your actual subnet IDs and route table IDs
      // You can find these in AWS Console > VPC > Subnets
      // Backend (app/data) private subnets used by DB, API, Lambdas
      const backendSubnetId: string = "subnet-0963658e86737910e"; // prd-phar-empath-ai-prd-back-ca-central-1a
      const backendSubnetId2: string = "subnet-0ce0b8beeb6c4e9f8"; // prd-phar-empath-ai-prd-back-ca-central-1b
      const backendSubnetId3: string = ""; // OPTIONAL: Backend subnet for ca-central-1d

      // Front (LB/ECS/frontend) private subnets requested for frontend systems
      const frontSubnetId: string = "subnet-097665934d5d0f7c2"; // prd-phar-empath-ai-prd-front-ca-central-1a
      const frontSubnetId2: string = "subnet-03989c770b42052a2"; // prd-phar-empath-ai-prd-front-ca-central-1b
      // optional third AZ if needed in future
      const frontSubnetId3: string = "";
      
      // Route table IDs for the subnets above (find in AWS Console > VPC > Subnets > Route table tab)
      const backendRouteTableId: string = "rtb-0584d7bd2c3ba7bf1"; // Route table ID for backendSubnetId
      const backendRouteTableId2: string = "rtb-0584d7bd2c3ba7bf1"; // Route table ID for backendSubnetId2
      const backendRouteTableId3: string = ""; // OPTIONAL: Route table ID for backendSubnetId3

      const vciPrefix = "VIRTUAL-CARE-INTERACTION-production";

      this.vpcCidrString = "10.102.0.0/25";

      // Determine if we should use specific subnets or CloudFormation imports
      // When using specific subnets, we will only use the AZs for which subnets are provided
      const providedSubnetIds = [backendSubnetId, backendSubnetId2, backendSubnetId3].filter((s) => !!s);
      const providedRouteTableIds = [backendRouteTableId, backendRouteTableId2, backendRouteTableId3].filter((r) => !!r);
      const useSpecificSubnets = providedSubnetIds.length > 0;

      // VPC for application
      this.vpc = ec2.Vpc.fromVpcAttributes(this, `${id}-Vpc`, {
        vpcId: existingVpcId,
        availabilityZones: useSpecificSubnets
          ? // Infer AZs from known mapping of provided subnets; if only one, keep single AZ
            providedSubnetIds.length === 1
              ? ["ca-central-1a"]
              : ["ca-central-1a", "ca-central-1b", "ca-central-1d"].slice(0, providedSubnetIds.length)
          : ["ca-central-1a", "ca-central-1b", "ca-central-1d"],
        privateSubnetIds: useSpecificSubnets
          ? providedSubnetIds
          : [
              Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet1AID`),
              Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet2AID`),
              Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet3AID`),
            ],
        // Don't specify publicSubnetIds - use private subnets only for the deployment
        // This is the preferred architecture: all resources in private subnets with NAT
        privateSubnetRouteTableIds: useSpecificSubnets
          ? providedRouteTableIds.length > 0 ? providedRouteTableIds : undefined
          : [
              Fn.importValue(
                `${AWSControlTowerStackSet}-PrivateSubnet1ARouteTable`
              ),
              Fn.importValue(
                `${AWSControlTowerStackSet}-PrivateSubnet2ARouteTable`
              ),
              Fn.importValue(
                `${AWSControlTowerStackSet}-PrivateSubnet3ARouteTable`
              ),
            ],
        vpcCidrBlock: useSpecificSubnets ? this.vpcCidrString : Fn.importValue(`${AWSControlTowerStackSet}-VPCCIDR`),
      }) as ec2.Vpc;

      // Extract CIDR ranges from the private subnets
      this.privateSubnetsCidrStrings = useSpecificSubnets ? [] : [
        Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet1ACIDR`),
        Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet2ACIDR`),
        Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet3ACIDR`),
      ];

      // Expose front-end subnets for selective placement (e.g., ALB/NLB/ECS)
      // These subnets remain separate from the VPC's default private subnets (backend)
      const frontSubnetIds = [frontSubnetId, frontSubnetId2, frontSubnetId3].filter((s) => !!s);
      // Using lightweight ISubnet references from IDs is sufficient for placement
      this.frontPrivateSubnets = frontSubnetIds.map((sid, idx) =>
        ec2.Subnet.fromSubnetId(this, `${id}-FrontSubnet-${idx + 1}`, sid)
      );

      // Skip public subnet creation if using specific subnets or if existingPublicSubnetID is set
      if (false && !useSpecificSubnets) {
        console.log(
          "No public subnet exists. Creating new public subnet, IGW, and NAT GW."
        );

        // Create a public subnet
        const publicSubnet = new ec2.Subnet(this, `PublicSubnet`, {
          vpcId: this.vpc.vpcId,
          availabilityZone: this.vpc.availabilityZones[0],
          cidrBlock: this.vpcCidrString,
          mapPublicIpOnLaunch: true,
        });

        // Create an Internet Gateway and attach it to the VPC
        const internetGateway = new ec2.CfnInternetGateway(
          this,
          `InternetGateway`,
          {}
        );
        new ec2.CfnVPCGatewayAttachment(this, "VPCGatewayAttachment", {
          vpcId: this.vpc.vpcId,
          internetGatewayId: internetGateway.ref,
        });

        // Add a NAT Gateway in the public subnet
        const natGateway = new ec2.CfnNatGateway(this, `NatGateway`, {
          subnetId: publicSubnet.subnetId,
          allocationId: new ec2.CfnEIP(this, "EIP", {}).attrAllocationId,
        });

        // Use the route table associated with the public subnet
        const publicRouteTableId = publicSubnet.routeTable.routeTableId;

        // Add a route to the Internet Gateway in the existing public route table
        new ec2.CfnRoute(this, `PublicRoute`, {
          routeTableId: publicRouteTableId,
          destinationCidrBlock: "0.0.0.0/0",
          gatewayId: internetGateway.ref,
        });

        // Update route table for private subnets
        new ec2.CfnRoute(this, `${vciPrefix}PrivateSubnetRoute1`, {
          routeTableId: this.vpc.privateSubnets[0].routeTable.routeTableId,
          destinationCidrBlock: "0.0.0.0/0",
          natGatewayId: natGateway.ref,
        });

        new ec2.CfnRoute(this, `${vciPrefix}PrivateSubnetRoute2`, {
          routeTableId: this.vpc.privateSubnets[1].routeTable.routeTableId,
          destinationCidrBlock: "0.0.0.0/0",
          natGatewayId: natGateway.ref,
        });

        new ec2.CfnRoute(this, `${vciPrefix}PrivateSubnetRoute3`, {
          routeTableId: this.vpc.privateSubnets[2].routeTable.routeTableId,
          destinationCidrBlock: "0.0.0.0/0",
          natGatewayId: natGateway.ref,
        });
      } else {
        console.log(
          useSpecificSubnets 
            ? `Using specific subnets. Skipping creation of public resources.`
            : `Public subnet already exists. Skipping creation of public resources.`
        );
      }

      // Add interface endpoints for private subnets
      this.vpc.addInterfaceEndpoint("SSM Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SSM,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true, // Enable private DNS for proper resolution
      });

      this.vpc.addInterfaceEndpoint("Secrets Manager Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true, // Enable private DNS for proper resolution
      });

      this.vpc.addInterfaceEndpoint("RDS Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.RDS,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true, // Enable private DNS for proper resolution
      });

      this.vpc.addInterfaceEndpoint("Glue Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.GLUE,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true, // Enable private DNS for proper resolution
      });
      
      // Add API Gateway VPC endpoint
      this.vpc.addInterfaceEndpoint("API Gateway Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.APIGATEWAY,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: true,
      });

      this.vpc.addFlowLog(`${id}-vpcFlowLog`);

      // Get default security group for VPC
      const defaultSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
        this,
        id,
        this.vpc.vpcDefaultSecurityGroup
      );
    } else {
      this.vpcCidrString = "10.0.0.0/16";

      const natGatewayProvider = ec2.NatProvider.gateway();

      // VPC for application
      this.vpc = new ec2.Vpc(this, "vci-Vpc", {
        ipAddresses: ec2.IpAddresses.cidr(this.vpcCidrString),
        natGatewayProvider: natGatewayProvider,
        natGateways: 1,
        maxAzs: 2,
        subnetConfiguration: [
          {
            name: "public-subnet-1",
            subnetType: ec2.SubnetType.PUBLIC,
          },
          {
            name: "private-subnet-1",
            subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          },
          {
            name: "isolated-subnet-1",
            subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          },
        ],
      });

      this.vpc.addFlowLog("vci-vpcFlowLog");

      // Add secrets manager endpoint to VPC
      this.vpc.addInterfaceEndpoint(`${id}-Secrets Manager Endpoint`, {
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      });

      // Add RDS endpoint to VPC
      this.vpc.addInterfaceEndpoint(`${id}-RDS Endpoint`, {
        service: ec2.InterfaceVpcEndpointAwsService.RDS,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      });
    }
  }
}
