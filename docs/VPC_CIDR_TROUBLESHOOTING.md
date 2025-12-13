# VPC CIDR Configuration Troubleshooting

## Critical Issue: VPC CIDR Mismatch

This document details a critical networking issue that can prevent Lambda functions from connecting to RDS databases when deploying to an existing VPC.

## The Problem

When deploying to an existing VPC with specific subnet IDs, Lambda functions may timeout when attempting to connect to the RDS database with the error:

```
Error: connect ETIMEDOUT <IP>:5432
```

This occurs even when:
- ✅ Security groups are correctly configured
- ✅ Network ACLs allow traffic
- ✅ Lambda is in the same VPC as RDS
- ✅ Route tables are properly configured

## Root Cause

The issue stems from **VPC CIDR block misconfiguration** in `cdk/lib/vpc-stack.ts`. 

### How VPCs Can Have Multiple CIDR Blocks

AWS allows a single VPC to have multiple CIDR blocks:
- **Primary CIDR**: Set when the VPC is created
- **Secondary CIDRs**: Can be added later to expand IP address space

Subnets can be created in any of these CIDR blocks.

### The Critical Mistake

When configuring `this.vpcCidrString` in `vpc-stack.ts`, you might use the **primary VPC CIDR** without checking if your subnets actually reside in that CIDR block.

**Example Scenario:**

Your VPC has two CIDR blocks:
- Primary: `10.102.252.160/27`
- Secondary: `10.102.0.0/25`

Your subnets are:
- Subnet 1: `10.102.0.64/27` (in secondary CIDR)
- Subnet 2: `10.102.0.96/27` (in secondary CIDR)

If you configure:
```typescript
this.vpcCidrString = "10.102.252.160/27"; // ❌ WRONG - Primary CIDR
```

The RDS security group will allow traffic from `10.102.252.160/27`, but the Lambda (at `10.102.0.x`) will be **blocked** because it's not in that CIDR range.

## How Security Groups Use CIDR Blocks

When you configure a security group ingress rule like:
```typescript
securityGroup.addIngressRule(
    ec2.Peer.ipv4(vpcStack.vpcCidrString),
    ec2.Port.tcp(5432),
    "Allow PostgreSQL traffic from VPC"
);
```

This creates a rule that **only** allows traffic from the specified CIDR block. If the Lambda's IP address is not within that CIDR, the connection will be **silently dropped** by the security group.

## The Solution

### Step 1: Identify All VPC CIDR Blocks

```bash
aws ec2 describe-vpcs --vpc-ids <vpc-id> \
  --query "Vpcs[0].CidrBlockAssociationSet[*].CidrBlock" \
  --output table \
  --profile <your-profile>
```

**Example Output:**
```
--------------------
|  DescribeVpcs    |
+------------------+
|  10.102.252.160/27
|  10.102.0.0/25
+------------------+
```

### Step 2: Verify Subnet CIDR Blocks

```bash
aws ec2 describe-subnets \
  --subnet-ids subnet-0963658e86737910e subnet-0ce0b8beeb6c4e9f8 \
  --query "Subnets[*].[SubnetId,CidrBlock,AvailabilityZone]" \
  --output table \
  --profile <your-profile>
```

**Example Output:**
```
-----------------------------------------------------------------
|                        DescribeSubnets                        |
+--------------------------+------------------+-----------------+
|  subnet-0963658e86737910e|  10.102.0.64/27  |  ca-central-1a  |
|  subnet-0ce0b8beeb6c4e9f8|  10.102.0.96/27  |  ca-central-1b  |
+--------------------------+------------------+-----------------+
```

### Step 3: Determine the Correct CIDR

Look at which VPC CIDR block contains your subnet CIDR blocks:
- Subnets `10.102.0.64/27` and `10.102.0.96/27` are within `10.102.0.0/25` ✅
- They are **NOT** within `10.102.252.160/27` ❌

### Step 4: Update vpc-stack.ts

```typescript
// In cdk/lib/vpc-stack.ts (around line 37)
this.vpcCidrString = "10.102.0.0/25"; // ✅ CORRECT - Use the CIDR that contains your subnets
```

### Step 5: Redeploy

```bash
cd cdk
npx cdk deploy Empath-AI-VpcStack Empath-AI-Database --profile <your-profile>
```

This updates the RDS security group rules to allow traffic from the correct CIDR range.

## Verification

After deployment, verify the security group rules:

```bash
# Get RDS security group ID
RDS_SG=$(aws rds describe-db-instances \
  --query "DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId" \
  --output text \
  --profile <your-profile>)

# Check ingress rules
aws ec2 describe-security-groups --group-ids $RDS_SG \
  --query "SecurityGroups[0].IpPermissions[?ToPort==\`5432\`].IpRanges[*].CidrIp" \
  --output table \
  --profile <your-profile>
```

You should see the correct CIDR block (e.g., `10.102.0.0/25`) in the output.

## Testing Connectivity

After fixing the CIDR configuration, test Lambda connectivity:

1. **Deploy DBFlow Stack:**
   ```bash
   npx cdk deploy Empath-AI-DBFlow --profile <your-profile>
   ```

2. **Success Indicators:**
   - Lambda function successfully connects to RDS
   - Database migrations run without timeout errors
   - DBFlow stack status: `CREATE_COMPLETE`

3. **Check Lambda Logs:**
   ```bash
   aws logs tail /aws/lambda/Empath-AI-DBFlow-initializerFunction \
     --follow \
     --profile <your-profile>
   ```

## Prevention Checklist

Before deploying to an existing VPC:

- [ ] Run `describe-vpcs` to list **all** CIDR blocks (including secondary)
- [ ] Run `describe-subnets` to get subnet CIDR blocks
- [ ] Verify which VPC CIDR contains your subnet CIDRs
- [ ] Update `this.vpcCidrString` with the correct CIDR
- [ ] Document the CIDR configuration for future deployments
- [ ] Create RDS service-linked role if first-time RDS deployment
- [ ] Ensure at least 2 subnets in different AZs for RDS Multi-AZ

## Additional Resources

- [ExistingVPCDeployment.md](./ExistingVPCDeployment.md) - Full VPC import guide
- [troubleshootingGuide.md](./troubleshootingGuide.md) - Network connectivity troubleshooting
- [AWS VPC Documentation](https://docs.aws.amazon.com/vpc/latest/userguide/configure-your-vpc.html)
- [AWS Security Groups](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_SecurityGroups.html)

## Key Takeaways

1. **VPCs can have multiple CIDR blocks** - always check for secondary CIDRs
2. **Security group rules are CIDR-specific** - they must match where your resources actually are
3. **The primary VPC CIDR may not contain your subnets** - subnets can be in secondary CIDRs
4. **Always verify, don't assume** - use AWS CLI to confirm CIDR configurations
5. **Document your configuration** - future deployments will thank you
