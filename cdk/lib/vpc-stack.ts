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

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const existingVpcId: string = "vpc-0515a0d6ee4abcd8e"; // CHANGE IF DEPLOYING WITH EXISTING VPC

    if (existingVpcId !== "") {
      const AWSControlTowerStackSet =
        "StackSet-AWSControlTowerBP-VPC-ACCOUNT-FACTORY-V1-df80d055-f27d-4b9a-917f-f0db2da2ad91"; // CHANGE TO YOUR CONTROL TOWER STACK SET
      const existingPublicSubnetID: string = ""; // CHANGE IF DEPLOYING WITH EXISTING PUBLIC SUBNET

      const vciPrefix = "VIRTUAL-CARE-INTERACTION-production";

      this.vpcCidrString = "172.31.128.0/20";

      // VPC for application
      this.vpc = ec2.Vpc.fromVpcAttributes(this, `${id}-Vpc`, {
        vpcId: existingVpcId,
        availabilityZones: ["ca-central-1a", "ca-central-1b", "ca-central-1d"],
        privateSubnetIds: [
          Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet1AID`),
          Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet2AID`),
          Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet3AID`),
        ],
        privateSubnetRouteTableIds: [
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
        vpcCidrBlock: Fn.importValue(`${AWSControlTowerStackSet}-VPCCIDR`),
      }) as ec2.Vpc;

      // Extract CIDR ranges from the private subnets
      this.privateSubnetsCidrStrings = [
        Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet1ACIDR`),
        Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet2ACIDR`),
        Fn.importValue(`${AWSControlTowerStackSet}-PrivateSubnet3ACIDR`),
      ];

      if (existingPublicSubnetID === "") {
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
          `Public subnet already exists. Skipping creation of public resources.`
        );
      }

      // Add interface endpoints for private subnets
      this.vpc.addInterfaceEndpoint("SSM Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SSM,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: false, // Disable private DNS to avoid conflicts
      });

      this.vpc.addInterfaceEndpoint("Secrets Manager Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: false, // Disable private DNS to avoid conflicts
      });

      this.vpc.addInterfaceEndpoint("RDS Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.RDS,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: false, // Disable private DNS to avoid conflicts
      });

      this.vpc.addInterfaceEndpoint("Glue Endpoint", {
        service: ec2.InterfaceVpcEndpointAwsService.GLUE,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        privateDnsEnabled: false, // Disable private DNS to avoid conflicts
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
