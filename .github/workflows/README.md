# GitHub Actions Deployment Workflows

This directory contains GitHub Actions workflows for automated deployment of the Empathetic Communication application to AWS.

## Workflows

### 1. `deploy-cdk.yml` - CDK Infrastructure Deployment
Deploys the AWS CDK infrastructure stack including:
- VPC and networking
- API Gateway and Lambda functions
- RDS PostgreSQL database
- ECS Fargate containers for Socket.IO server
- AWS Amplify app setup
- All other backend AWS resources

**Triggers:**
- Automatically when a new release is published on GitHub
- Manually via `workflow_dispatch` with customizable stack prefix and release tag

**Requirements:**
- Node.js 20
- Python 3.11
- Poetry
- Docker (used during CDK deployment for Lambda layers and containers)

### 2. `trigger-amplify-build.yml` - Amplify Frontend Build
Triggers and monitors AWS Amplify builds for the frontend application.

**Triggers:**
- Automatically when a new release is published on GitHub
- Manually via `workflow_dispatch` with customizable app ID, branch name, and release tag

**Features:**
- Automatically retrieves Amplify App ID from CloudFormation stack
- Monitors build progress and reports status
- Waits for build completion (timeout: 30 minutes)
- Outputs deployed application URL
- Deploys specific release tags for controlled deployments

## Prerequisites

### AWS Setup

Before using these workflows, you must complete the following AWS setup:

1. **Create AWS Secrets and Parameters**

   Run these commands with your AWS CLI:

   ```bash
   # GitHub Personal Access Token
   aws secretsmanager create-secret \
       --name github-personal-access-token \
       --secret-string '{"my-github-token": "<YOUR-GITHUB-TOKEN>"}' \
       --profile <YOUR-PROFILE-NAME>
   
   # GitHub Username
   aws ssm put-parameter \
       --name "vci-owner-name" \
       --value "<YOUR-GITHUB-USERNAME>" \
       --type String \
       --profile <YOUR-PROFILE-NAME>
   
   # Database Username
   aws secretsmanager create-secret \
       --name VCISecrets \
       --secret-string '{"DB_Username":"<YOUR-DB-USERNAME>"}' \
       --profile <YOUR-PROFILE-NAME>
   
   # Allowed Email Domains
   aws ssm put-parameter \
       --name "/VCI/AllowedEmailDomains" \
       --value "<YOUR-ALLOWED-EMAIL-DOMAIN-LIST>" \
       --type SecureString \
       --profile <YOUR-PROFILE-NAME>
   ```

2. **Create IAM User for GitHub Actions**

   Create an IAM user with programmatic access for GitHub Actions deployments.

   **Using AWS Console:**
   1. Go to IAM → Users → Create user
   2. User name: `github-actions-deployment`
   3. Click "Next"
   4. Select "Attach policies directly"
   5. Attach the following policies:
      - `AdministratorAccess` (or create a custom policy with least privilege)
   6. Click "Next" → "Create user"
   7. Go to the user → Security credentials → Create access key
   8. Select "Command Line Interface (CLI)"
   9. Confirm and create access key
   10. **Save the Access Key ID and Secret Access Key** (you'll need these for GitHub secrets)

   **Using AWS CLI:**
   ```bash
   # Create IAM user
   aws iam create-user --user-name github-actions-deployment
   
   # Attach AdministratorAccess policy (adjust as needed for least privilege)
   aws iam attach-user-policy \
       --user-name github-actions-deployment \
       --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
   
   # Create access key
   aws iam create-access-key --user-name github-actions-deployment
   ```
   
   **Important:** Save the `AccessKeyId` and `SecretAccessKey` from the output.

### GitHub Secrets Configuration

Add the following secrets to your GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Description | Example |
|------------|-------------|---------||
| `AWS_ACCESS_KEY_ID` | Access Key ID from IAM user | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | Secret Access Key from IAM user | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `AWS_ACCOUNT_ID` | Your AWS Account ID | `123456789012` |
| `STACK_PREFIX` | (Optional) Prefix for stack resources | `Empathetic-Communication` |

### GitHub Repository Settings

1. **Fork this repository** to your GitHub account
2. **Enable GitHub Actions** in your forked repository
3. **Ensure Docker is available** in GitHub Actions (pre-installed in ubuntu-latest runners)

## Usage

### First-Time Deployment

1. **Setup AWS Prerequisites** (see above sections)
2. **Configure GitHub Secrets** (see above)
3. **Create a Release**:
   - Go to your GitHub repository
   - Click on "Releases" → "Draft a new release"
   - Create a new tag (e.g., `v1.0.0`)
   - Add release title and description
   - Click "Publish release"

4. **Workflows will automatically trigger** when the release is published:
   - CDK infrastructure will be deployed
   - Amplify redirects will be configured automatically
   - Amplify build will be triggered

### Automated Deployments

After initial setup, deployments are automatic:
- **Create a new release** on GitHub to trigger deployment of both infrastructure and frontend
- The workflows will deploy the exact code from the release tag
- Both workflows run in parallel when a release is published

### Manual Deployments

You can manually trigger workflows from the Actions tab:
- Select the workflow
- Click "Run workflow"
- Optionally specify a release tag to deploy (or leave empty for latest)
- Customize other parameters if needed
- Click "Run workflow"

### Creating Releases

To create a new release and trigger deployment:

```bash
# Create and push a new tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0

# Or use GitHub CLI
gh release create v1.0.0 --title "Version 1.0.0" --notes "Release notes here"
```

Then publish the release through GitHub UI or CLI, which will automatically trigger the deployment workflows.

## Monitoring Deployments

### CDK Deployment
- Check GitHub Actions workflow run for detailed logs
- Monitor AWS CloudFormation in AWS Console for stack creation progress
- Typical deployment time: 15-30 minutes

### Amplify Build
- The workflow monitors build status automatically
- Check AWS Amplify Console for detailed build logs
- Build URL will be output in the workflow logs
- Typical build time: 5-10 minutes

## Troubleshooting

### Common Issues

1. **"CDK Bootstrap Required" Error**
   - Run bootstrap manually: `cdk bootstrap aws://<account-id>/<region>`
   - Or the workflow will attempt to bootstrap automatically

2. **"Insufficient Permissions" Error**
   - Verify IAM user has necessary permissions attached
   - Check that the access key is active and not expired
   - Verify the correct AWS account is being used

3. **"Docker Command Not Found"**
   - Ensure Docker daemon is running
   - For local development, start Docker Desktop
   - GitHub Actions runners have Docker pre-installed

4. **"Amplify App Not Found"**
   - Ensure CDK deployment completed successfully
   - Verify the stack prefix matches
   - Manually provide Amplify App ID in workflow inputs

5. **Poetry Installation Issues**
   - Workflows automatically install Poetry and required plugins
   - If issues persist, check Poetry version compatibility

### Getting Help

For detailed troubleshooting, see:
- [Deployment Guide](../docs/deploymentGuide.md)
- [Troubleshooting Guide](../docs/troubleshootingGuide.md)
- [Architecture Deep Dive](../docs/architectureDeepDive.md)

## Clean Up

To remove all deployed resources:

1. **Delete CloudFormation Stacks**:
   ```bash
   aws cloudformation delete-stack --stack-name <stack-prefix>-Amplify
   aws cloudformation delete-stack --stack-name <stack-prefix>-ECSStack
   aws cloudformation delete-stack --stack-name <stack-prefix>-APIServiceStack
   aws cloudformation delete-stack --stack-name <stack-prefix>-DBFlowStack
   aws cloudformation delete-stack --stack-name <stack-prefix>-DatabaseStack
   aws cloudformation delete-stack --stack-name <stack-prefix>-VPCStack
   ```

2. **Delete Secrets**:
   ```bash
   aws secretsmanager delete-secret --secret-id github-personal-access-token --force-delete-without-recovery
   aws secretsmanager delete-secret --secret-id VCISecrets --force-delete-without-recovery
   ```

3. **Delete SSM Parameters**:
   ```bash
   aws ssm delete-parameter --name "vci-owner-name"
   aws ssm delete-parameter --name "/VCI/AllowedEmailDomains"
   ```

## Security Considerations

- **Never commit AWS credentials** to the repository
- **Use IAM users with least privilege** - adjust the AdministratorAccess policy as needed for production
- **Rotate AWS access keys regularly** - AWS recommends rotation every 90 days
- **Rotate secrets regularly**, especially the GitHub personal access token
- **Review CloudFormation stack policies** for production deployments
- **Enable AWS CloudTrail** for audit logging
- **Use branch protection rules** to prevent unauthorized deployments
- **Store access keys securely** - only in GitHub Secrets, never in code or logs
- **Monitor IAM user activity** - regularly review CloudTrail logs for the deployment user

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [Managing AWS Access Keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html)
