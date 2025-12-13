# Existing VPC Deployment Guide 

## CDK Deployment for Existing VPC 

This section outlines the steps to deploy the application with a **Pre-existing VPC**. If you do not have an existing VPC, proceed to 3b: CDK Deployment in the [Deployment Guide](/docs/deploymentGuide.md).

### Prerequisites
- Access to the existing VPC with at least 2 private subnets across 2 availability zones
- AWS CLI configured with appropriate credentials
- CDK installed (via npx or globally)
- For first-time RDS deployment in the AWS account, you'll need IAM permissions to create service-linked roles

### Deployment Methods

There are two approaches to deploying with an existing VPC:

#### Method 1: Using Specific Subnet IDs (Recommended for Production)

This method directly specifies subnet IDs and is ideal for production deployments where you know exactly which subnets to use.

1. **Gather Required Information:**
   
   First, collect the following details from your AWS account:
   
   ```bash
   # Get VPC ID
   aws ec2 describe-vpcs --query "Vpcs[*].[VpcId,CidrBlock]" --output table --profile <your-profile>
   
   # Get subnet IDs and their CIDR blocks (need at least 2 in different AZs)
   aws ec2 describe-subnets --filters "Name=vpc-id,Values=<vpc-id>" \
     --query "Subnets[*].[SubnetId,CidrBlock,AvailabilityZone,Tags[?Key=='Name'].Value|[0]]" \
     --output table --profile <your-profile>
   
   # Get route table IDs for your subnets
   aws ec2 describe-route-tables \
     --filters "Name=association.subnet-id,Values=<subnet-id>" \
     --query "RouteTables[0].RouteTableId" \
     --output text --profile <your-profile>
   
   # CRITICAL: Get ALL VPC CIDR blocks (including secondary CIDRs)
   aws ec2 describe-vpcs --vpc-ids <vpc-id> \
     --query "Vpcs[0].CidrBlockAssociationSet[*].CidrBlock" \
     --output table --profile <your-profile>
   ```

2. **Determine the Correct VPC CIDR Block:**
   
   **⚠️ IMPORTANT:** Your VPC may have multiple CIDR blocks. You MUST use the CIDR block that contains your subnets.
   
   Example: If your VPC has:
   - Primary CIDR: `10.102.252.160/27`
   - Secondary CIDR: `10.102.0.0/25`
   
   And your subnets are:
   - Subnet 1: `10.102.0.64/27`
   - Subnet 2: `10.102.0.96/27`
   
   You must use `10.102.0.0/25` as the VPC CIDR (not the primary CIDR) because the subnets fall within this range.

3. **Modify the VPC Stack:**
   
   Navigate to `cdk/lib/vpc-stack.ts` and update the following variables (around lines 24-37):
   
   ```typescript
   // Update with your VPC ID
   const existingVpcId: string = "vpc-025783243153bb54c"; // Your VPC ID
   
   // Update with your private subnet IDs (need at least 2 in different AZs)
   const backendSubnetId: string = "subnet-0963658e86737910e"; // ca-central-1a
   const backendSubnetId2: string = "subnet-0ce0b8beeb6c4e9f8"; // ca-central-1b
   const backendSubnetId3: string = ""; // Optional third AZ
   
   // Update with route table IDs for each subnet
   const backendRouteTableId: string = "rtb-0584d7bd2c3ba7bf1"; // Route table for subnet 1
   const backendRouteTableId2: string = "rtb-0584d7bd2c3ba7bf1"; // Route table for subnet 2
   const backendRouteTableId3: string = ""; // Optional
   
   // CRITICAL: Use the CIDR block that contains your subnets (may be secondary CIDR)
   this.vpcCidrString = "10.102.0.0/25"; // Replace with correct CIDR from step 2
   ```

4. **Create RDS Service-Linked Role (First-Time RDS Deployment Only):**
   
   If this is the first time deploying RDS in your AWS account, create the service-linked role:
   
   ```bash
   aws iam create-service-linked-role --aws-service-name rds.amazonaws.com --profile <your-profile>
   ```
   
   You can verify if it exists:
   ```bash
   aws iam get-role --role-name AWSServiceRoleForRDS --profile <your-profile>
   ```

#### Method 2: Using AWS Control Tower Stack Sets

This method uses CloudFormation exports from AWS Control Tower and is suitable for Control Tower-managed environments.

1. **Modify the VPC Stack:**
   - Navigate to `cdk/lib/vpc-stack.ts`
   - Set `existingVpcId` to empty string to use Control Tower imports
   - Update the AWS Control Tower Stack Set name (around line 21):
     ```typescript
     const AWSControlTowerStackSet = "your-stackset-name";
     ```
   - You can find this in CloudFormation console under Stacks, look for `StackSet-AWSControlTowerBP-VPC-ACCOUNT-FACTORY`

### Deployment Changes

Depending on the method chosen, the following resources are configured:

**Method 1 (Specific Subnets):**
- **VPC Import:** Existing VPC is imported by ID with explicit subnet IDs
- **Private Subnets:** Uses pre-existing private subnets (no public subnets created)
- **Interface Endpoints:** VPC endpoints for SSM, Secrets Manager, RDS, API Gateway, and Glue are created
- **Security Groups:** Configured to allow traffic from the correct VPC CIDR block
- **RDS Configuration:** Multi-AZ RDS instance deployed across specified subnets
- **Lambda Functions:** Deployed in VPC with access to RDS via security groups

**Method 2 (Control Tower):**
- **VPC Identification:** Existing VPC imported via Control Tower CloudFormation exports
- **Private and Isolated Subnets:** Imported using Control Tower stack references
- **Interface Endpoints:** Created in isolated subnets for secure access
- **NAT Gateway:** Created for outbound internet access from private subnets
- **Route Tables:** Updated to route traffic through NAT gateway

### Common Pitfalls and Solutions

#### 1. VPC CIDR Mismatch
**Problem:** Lambda functions timeout when connecting to RDS with error: `Error: connect ETIMEDOUT`

**Cause:** The VPC CIDR configured in `vpc-stack.ts` doesn't match the actual subnet CIDR range.

**Solution:** 
- Always check for multiple CIDR blocks on the VPC
- Use the CIDR block that contains your subnets (may be a secondary CIDR)
- Verify subnet IPs fall within the configured CIDR range

#### 2. Missing RDS Service-Linked Role
**Problem:** Database stack fails with: `RDS is not authorized to assume service-linked role`

**Solution:** Create the service-linked role before deployment:
```bash
aws iam create-service-linked-role --aws-service-name rds.amazonaws.com
```

#### 3. Subnet Availability Zone Coverage
**Problem:** RDS deployment fails with: `The DB subnet group doesn't meet Availability Zone (AZ) coverage requirement`

**Solution:** Ensure you specify at least 2 subnets in different availability zones in `vpc-stack.ts`.

These changes ensure the application seamlessly integrates into the existing VPC with proper network connectivity.