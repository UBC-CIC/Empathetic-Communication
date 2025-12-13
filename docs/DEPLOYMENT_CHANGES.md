# Deployment Changes Summary

This document provides a quick reference for all changes made during the production deployment to an existing VPC.

## Files Modified

### 1. Core Infrastructure
**File**: `cdk/lib/vpc-stack.ts`  
**Line**: 37  
**Change**: Updated VPC CIDR from incorrect value to actual subnet CIDR
```typescript
// Before
this.vpcCidrString = "172.31.128.0/20";

// After
this.vpcCidrString = "10.102.0.0/25";
```
**Why**: VPC had multiple CIDR blocks. Primary CIDR didn't contain the subnets. Security groups need the correct CIDR for Lambda-to-RDS connectivity.

### 2. Database Setup
**File**: `cdk/lambda/db_setup/index.js`  
**Lines**: 135-185  
**Change**: Fixed PostgreSQL DO block syntax for user creation
```javascript
// Before (incorrect - causes syntax errors)
DO $$
BEGIN
  IF NOT EXISTS (...) THEN
    EXECUTE 'CREATE USER ${RW_NAME} WITH PASSWORD \'' || '${rwPass}' || '\'';
  END IF;
END$$;

// After (correct - uses DECLARE and format())
DO $$
DECLARE
  rw_pass TEXT := '${rwPass}';
BEGIN
  IF NOT EXISTS (...) THEN
    EXECUTE format('CREATE USER %I WITH PASSWORD %L', '${RW_NAME}', rw_pass);
  ELSE
    EXECUTE format('ALTER USER %I WITH PASSWORD %L', '${RW_NAME}', rw_pass);
  END IF;
END$$;
```
**Why**: PostgreSQL requires proper DECLARE blocks and format() specifiers (%I for identifiers, %L for literals).

## New Files Created

### 1. Deployment Helper Script
**File**: `deploy.ps1`  
**Purpose**: Automates deployment with correct Docker configuration  
**Usage**:
```powershell
# Deploy all stacks
.\deploy.ps1 -Profile empath-prod

# Deploy specific stacks
.\deploy.ps1 -Profile empath-prod -Stacks "Empath-AI-Api","Empath-AI-EcsSocket"
```
**Features**:
- Automatically sets DOCKER_BUILDKIT=0
- Verifies Docker is running
- Provides clear deployment progress messages
- Handles CDK deployment with correct parameters

### 2. Deployment Status Report
**File**: `DEPLOYMENT_STATUS.md`  
**Purpose**: Comprehensive deployment status and lessons learned  
**Contents**:
- Stack-by-stack deployment status
- Critical issues and resolutions
- Timeline and effort estimates
- Post-deployment checklist
- Useful commands for verification
- Lessons learned and best practices

### 3. VPC CIDR Troubleshooting Guide
**File**: `docs/VPC_CIDR_TROUBLESHOOTING.md`  
**Purpose**: Deep dive into VPC CIDR configuration issues  
**Contents**:
- Understanding the problem
- How VPCs with multiple CIDRs work
- Step-by-step diagnosis procedures
- AWS CLI commands for verification
- Prevention checklist

## Documentation Updates

### 1. Existing VPC Deployment Guide
**File**: `docs/ExistingVPCDeployment.md`  
**Status**: Completely rewritten  
**Key Additions**:
- Two deployment methods (specific subnets vs Control Tower)
- VPC CIDR discovery commands
- Critical warning about multiple CIDR blocks
- Common pitfalls section with solutions
- Step-by-step CIDR verification process

### 2. Troubleshooting Guide
**File**: `docs/troubleshootingGuide.md`  
**New Sections Added**:
- **Network Connectivity Issues**
  - Lambda cannot connect to RDS
  - VPC CIDR mismatch symptoms and solutions
  - Security group verification
- **Deployment Issues**
  - Service-linked role missing
  - Stack rollback scenarios
  - SQL syntax errors in migrations
- **Docker BuildKit and Lambda Compatibility**
  - Symptoms of manifest format errors
  - PowerShell and Bash solutions
  - Permanent configuration options
  - Verification steps

### 3. Deployment Guide
**File**: `docs/deploymentGuide.md`  
**Updates**:
- Added Docker configuration warning before prerequisites
- PowerShell and Bash commands for DOCKER_BUILDKIT=0
- Alternative permanent configuration via Docker config.json
- Link to troubleshooting guide for Docker issues
- Warning about VPC CIDR validation for existing VPC deployments

### 4. README
**File**: `README.md`  
**Updates**:
- Added "Deployment Status" section to index
- Added "Quick Start Deployment Script" section with usage examples
- Updated VPC CIDR Configuration section with link to troubleshooting guide
- Clear note about automatic Docker configuration in helper script

## Configuration Changes Required

### Environment Variables (Required for Deployment)
```powershell
# PowerShell
$env:DOCKER_BUILDKIT = "0"
$env:DOCKER_CLI_HINTS = "false"

# Bash/zsh
export DOCKER_BUILDKIT=0
export DOCKER_CLI_HINTS=false
```

### AWS CLI Commands (One-time setup)
```powershell
# Create RDS service-linked role (first-time only)
aws iam create-service-linked-role --aws-service-name rds.amazonaws.com --profile empath-prod

# Verify VPC CIDR blocks
aws ec2 describe-vpcs --vpc-ids vpc-025783243153bb54c --profile empath-prod --query 'Vpcs[0].CidrBlockAssociationSet[*].[CidrBlock,AssociationId,CidrBlockState.State]' --output table

# Check subnet CIDRs
aws ec2 describe-subnets --subnet-ids subnet-0963658e86737910e subnet-0ce0b8beeb6c4e9f8 --profile empath-prod --query 'Subnets[*].[SubnetId,CidrBlock,AvailabilityZone]' --output table
```

## Deployment Order

The correct deployment order with dependencies:

1. **Empath-AI-Vpc** (VPC and networking)
   - Creates/configures VPC, subnets, security groups
   - Must have correct VPC CIDR configured

2. **Empath-AI-Database** (RDS PostgreSQL)
   - Depends on: Vpc
   - Requires: RDS service-linked role

3. **Empath-AI-DBFlow** (Database migrations)
   - Depends on: Database
   - Initializes schema and users

4. **Empath-AI-Api** (Lambda functions and APIs)
   - Depends on: Database, DBFlow
   - Requires: DOCKER_BUILDKIT=0

5. **Empath-AI-EcsSocket** (WebSocket server)
   - Depends on: Database, Api
   - Requires: DOCKER_BUILDKIT=0

6. **Empath-AI-Amplify** (Frontend hosting)
   - Depends on: Api, EcsSocket
   - Requires: GitHub repository name parameter

## Critical Issues Reference

### Issue 1: VPC CIDR Mismatch
- **Error**: `connect ETIMEDOUT 10.102.0.90:5432`
- **File**: `cdk/lib/vpc-stack.ts` line 37
- **Fix**: Changed CIDR to 10.102.0.0/25 (secondary CIDR containing subnets)
- **Time to Resolve**: ~2 hours

### Issue 2: SQL Syntax Errors
- **Error**: `syntax error at or near "s"`
- **File**: `cdk/lambda/db_setup/index.js` lines 135-185
- **Fix**: Used DECLARE blocks and format() with %I and %L specifiers
- **Time to Resolve**: ~45 minutes

### Issue 3: Docker BuildKit Incompatibility
- **Error**: `The image manifest, config or layer media type ... is not supported`
- **Solution**: Set DOCKER_BUILDKIT=0 before deployment
- **Prevention**: Use deploy.ps1 script or manual env vars
- **Time to Resolve**: ~1 hour

### Issue 4: RDS Service-Linked Role
- **Error**: `RDS is not authorized to assume service-linked role ... Status Code: 403`
- **Fix**: Created role with AWS CLI command
- **Time to Resolve**: ~10 minutes

## Verification Commands

After deployment, verify everything is working:

```powershell
# Check all stack statuses
aws cloudformation describe-stacks --profile empath-prod --region ca-central-1 --query "Stacks[?starts_with(StackName, 'Empath-AI')].{Name:StackName,Status:StackStatus}" --output table

# Verify RDS is running
aws rds describe-db-instances --profile empath-prod --region ca-central-1 --query "DBInstances[*].{Name:DBInstanceIdentifier,Status:DBInstanceStatus,Endpoint:Endpoint.Address}" --output table

# Check Lambda functions
aws lambda list-functions --profile empath-prod --region ca-central-1 --query "Functions[?starts_with(FunctionName, 'Empath-AI')].{Name:FunctionName,Runtime:Runtime,Status:State}" --output table

# Verify ECS services
aws ecs list-services --cluster Empath-AI-EcsSocket-cluster --profile empath-prod --region ca-central-1

# Check Amplify app
aws amplify list-apps --profile empath-prod --region ca-central-1 --query "apps[*].{Name:name,Status:defaultDomain}" --output table
```

## Best Practices Established

1. **Always verify VPC CIDR** before deploying to existing VPC:
   ```powershell
   aws ec2 describe-vpcs --vpc-ids <vpc-id> --query 'Vpcs[0].CidrBlockAssociationSet[*].[CidrBlock,CidrBlockState.State]'
   ```

2. **Set Docker environment variables** before any CDK deployment with containers:
   ```powershell
   $env:DOCKER_BUILDKIT=0
   $env:DOCKER_CLI_HINTS="false"
   ```

3. **Test SQL migrations** in psql before deploying to Lambda:
   ```bash
   psql -h <endpoint> -U postgres -d postgres -f migration.sql
   ```

4. **Use deployment helper script** for consistent deployments:
   ```powershell
   .\deploy.ps1 -Profile <profile>
   ```

5. **Document all infrastructure decisions** in deployment guides and status reports

## Quick Reference Links

- [Deployment Status Report](../DEPLOYMENT_STATUS.md)
- [VPC CIDR Troubleshooting](../docs/VPC_CIDR_TROUBLESHOOTING.md)
- [Troubleshooting Guide](../docs/troubleshootingGuide.md)
- [Deployment Guide](../docs/deploymentGuide.md)
- [Existing VPC Deployment](../docs/ExistingVPCDeployment.md)

## Time Investment Summary

| Activity | Time Spent |
|----------|-----------|
| VPC CIDR troubleshooting and fix | ~2 hours |
| SQL syntax error resolution | ~45 minutes |
| Docker BuildKit issue diagnosis and fix | ~1 hour |
| RDS service-linked role creation | ~10 minutes |
| Documentation updates | ~30 minutes |
| Helper script creation | ~15 minutes |
| **Total** | **~4.5-5 hours** |

## Return on Investment

### Time Saved for Future Deployments
- **VPC CIDR verification**: 1 minute (vs 2 hours debugging)
- **Docker configuration**: 10 seconds (vs 1 hour troubleshooting)
- **SQL syntax**: 0 minutes (already fixed)
- **Service-linked role**: 0 minutes (one-time setup)

**Estimated Time Savings**: 3+ hours per future deployment

### Documentation Value
- Comprehensive troubleshooting guides prevent re-learning
- Deployment helper script ensures consistent deployments
- Status report provides historical context and lessons learned
- Future team members can deploy successfully without tribal knowledge

---

**Document Created**: During production deployment  
**Last Updated**: After EcsSocket/Amplify deployment started  
**Maintainer**: DevOps/Infrastructure Team
