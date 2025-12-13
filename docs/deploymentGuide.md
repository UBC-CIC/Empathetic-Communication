# Deployment Guide

## Table of Contents
- [Deployment Guide](#deployment-guide)
  - [Table of Contents](#table-of-contents)
  - [Requirements](#requirements)
  - [Package Management](#package-management)
  - [Pre-Deployment](#pre-deployment)
    - [Create GitHub Personal Access Token](#create-github-personal-access-token)
    - [Enable Models in Bedrock](#enable-models-in-bedrock)
  - [Deployment](#deployment)
    - [Step 1: Fork \& Clone The Repository](#step-1-fork--clone-the-repository)
    - [Step 2: Upload Secrets](#step-2-upload-secrets)
      - [CDK Deployment in a Pre-existing VPC](#cdk-deployment-in-a-pre-existing-vpc)
      - [Step-by-Step Instructions](#step-by-step-instructions)
    - [Step 3: CDK Deployment](#step-3-cdk-deployment)
  - [Post-Deployment](#post-deployment)
    - [Step 1: Build AWS Amplify App](#step-1-build-aws-amplify-app)
    - [Step 2: Change Redirects](#step-2-change-redirects)
    - [Step 3: Visit Web App](#step-3-visit-web-app)
  - [Cleanup](#cleanup)
    - [Taking down the deployed stack](#taking-down-the-deployed-stack)

## Deployment Steps

### CDK CLI usage
- Always run CDK commands from the `cdk/` folder and use the local CLI via `npx` so `cdk.json` is honored.
- If you run from the repository root, pass `--app` explicitly.

Examples (PowerShell):

```pwsh
Before you deploy, you must have the following installed on your device:
- [git](https://git-scm.com/downloads)
- [AWS Account](https://aws.amazon.com/account/)
- [GitHub Account](https://github.com/)
- [AWS CLI](https://aws.amazon.com/cli/)
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/cli.html) *(v2.122.0 > required)*
- [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
- [node](https://nodejs.org/en/ln/getting-started/how-to-install-nodejs) *(v20.0.0 > required)*
- [docker](https://www.docker.com/products/docker-desktop/)

**⚠️ Docker Configuration for Lambda Compatibility:**

If you're using Docker Desktop 28.x or newer, you must disable BuildKit before CDK deployments to ensure Lambda-compatible image formats:

**PowerShell (Windows):**
```powershell
$env:DOCKER_BUILDKIT=0
$env:DOCKER_CLI_HINTS="false"
```

**Bash/Terminal (macOS/Linux):**
```bash
export DOCKER_BUILDKIT=0
export DOCKER_CLI_HINTS=false
```

These environment variables must be set in the same terminal session before running `npx cdk deploy`.

**Alternative:** Create `~/.docker/config.json` with:
```json
{
  "features": {
    "buildkit": false
  }
}
```

See [Troubleshooting Guide - Docker BuildKit](./troubleshootingGuide.md#docker-buildkit-and-lambda-compatibility) for details.

**Using BuildKit safely for manual builds (outside CDK):**

When using BuildKit intentionally, produce Lambda-compatible manifests by using `buildx` with `--output=type=docker` and disable provenance metadata which Lambda rejects:

```powershell
$AWS_REGION = "ca-central-1"
$ACCOUNT_ID = (aws sts get-caller-identity --query Account --output text)
aws ecr create-repository --repository-name my-lambda-image --region $AWS_REGION 2>$null
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker buildx create --use --name lambda-builder
docker buildx inspect --bootstrap

docker buildx build \
  --platform linux/amd64 \
  --output=type=docker \
  --provenance=false \
  -t "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/my-lambda-image:latest" \
  ./cdk/data_ingestion

docker push "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/my-lambda-image:latest"

aws lambda update-function-code \
  --function-name Empath-AI-DataIngestLambdaDockerFunc \
  --image-uri "$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/my-lambda-image:latest" \
  --region $AWS_REGION
```


### VPC import (existing VPC)
- The stack supports importing an existing VPC by specifying private subnet IDs and their route table IDs in `cdk/lib/vpc-stack.ts`.
- It adapts to however many subnets you provide (1–3 AZs). **Minimum 2 subnets in different AZs required for RDS Multi-AZ deployment.**
- When using specific subnets, you **MUST** use the correct VPC CIDR that contains your subnets. This is critical for security group rules.

**⚠️ Important:** Your VPC may have multiple CIDR blocks. Always verify which CIDR block contains your subnets.

Required values in `vpc-stack.ts`:
- `existingVpcId`: your VPC ID
- `backendSubnetId`, `backendSubnetId2`: private subnet IDs in different AZs (at least 2 required)
- `backendSubnetId3`: optional third subnet for additional AZ
- `backendRouteTableId`, `backendRouteTableId2`, `backendRouteTableId3`: route table IDs for each subnet
- `this.vpcCidrString`: **The CIDR block that contains your subnets** (may be a secondary CIDR, not the primary!)

**Finding the correct VPC CIDR (PowerShell):**
```pwsh
# Get ALL CIDR blocks (including secondary) - VPCs can have multiple CIDRs
aws ec2 describe-vpcs --vpc-ids <vpc-id> `
  --query "Vpcs[0].CidrBlockAssociationSet[*].CidrBlock" `
  --output table --profile <your-profile>

# Get your subnet CIDR blocks
aws ec2 describe-subnets --subnet-ids <subnet-id-1> <subnet-id-2> `
  --query "Subnets[*].[SubnetId,CidrBlock]" `
  --output table --profile <your-profile>

# Use the VPC CIDR that contains your subnet CIDRs
# Example: If VPC has 10.102.252.160/27 and 10.102.0.0/25
#          and subnets are 10.102.0.64/27 and 10.102.0.96/27
#          Use: this.vpcCidrString = "10.102.0.0/25"
```

**Finding route table IDs (PowerShell):**
```pwsh
aws ec2 describe-route-tables `
  --filters "Name=association.subnet-id,Values=<subnet-id>" `
  --query "RouteTables[0].RouteTableId" `
  --output text --profile <your-profile>
```

**First-time RDS deployment:**
If this is the first time deploying RDS in your AWS account, create the service-linked role:
```pwsh
aws iam create-service-linked-role --aws-service-name rds.amazonaws.com --profile <your-profile>
```

For detailed VPC import instructions, see [ExistingVPCDeployment.md](./ExistingVPCDeployment.md).

## Package Management

This project uses [Poetry](https://python-poetry.org/) for Python dependency management to ensure consistent, reproducible builds across all environments. See [PYTHON_PACKAGE_MANAGEMENT.md](./PYTHON_PACKAGE_MANAGEMENT.md) for complete setup instructions.

### Quick Setup

### Common errors and fixes
- Error: `--app is required either in command-line, in cdk.json or in ~/.cdk.json`
```bash
# Install Poetry

- Error: `AWS::EarlyValidation::PropertyValidation` during `Empath-AI-VpcStack` deploy
curl -sSL https://install.python-poetry.org | py  # Windows
curl -sSL https://install.python-poetry.org | python3 -  # macOS/Linux

# Install export plugin
poetry self add poetry-plugin-export

- Warning: `No routeTableId was provided to the subnet ...` (link: https://github.com/aws/aws-cdk/pull/3171)

# Install CDK dependencies

### Recommended deployment sequence
1. Deploy VPC stack first to validate VPC endpoints and security groups:
```pwsh
cd cdk
npm install

# Deploy it now (Poetry handles Python dependencies automatically)
2. Deploy the rest:
```pwsh
```

**Note:** Poetry dependencies are installed automatically during Docker builds - no manual `poetry install` required for deployment.


### Notes
- Using private subnets only is supported; public subnets are not required for this architecture.
- If you later add more subnets for additional AZs, update `vpc-stack.ts` with their IDs and route tables, then redeploy.
## Pre-Deployment
### Create GitHub Personal Access Token
To deploy this solution, you will need to generate a GitHub personal access token. Please visit [here](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic) for detailed instruction to create a personal access token.

*Note: when selecting the scopes to grant the token (step 8 of the instruction), make sure you select `repo` scope.*

**Once you create a token, please note down its value as you will use it later in the deployment process.**

Docker must also be running for the deployment to work.

### Enable Models in Bedrock

First, navigate to Amazon Bedrock in the AWS Console. From the home page, click on model access under Bedrock configurations:
![](./images/bedrockhome.png)

Then click on "Modify model access":
![](./images/modifymodels.png)

Finally, enable the relevant models, click next and on the next page click submit. Enable `Amazon Titan Embeddings V2`, `Meta Llama 3 70B Instruct`, since they are required for this project. Then, within the `us-east-1` region enable `Nova Pro` for the empathy coach and `Nova Sonic` for the voice feature.
![](./images/enablemodels.png)

The relevant models are now enabled in Bedrock.
## Deployment
### Step 1: Fork & Clone The Repository
First, you need to fork the repository. To create a fork, navigate to the [main branch](https://github.com/UBC-CIC/Empathetic-Communication) of this repository. Then, in the top-right corner, click `Fork`.

![](./images/fork.jpeg)

You will be directed to the page where you can customize owner, repository name, etc, but you do not have to change any option. Simply click `Create fork` in the bottom right corner.

Now let's clone the GitHub repository onto your machine. To do this:
1. Create a folder on your computer to contain the project code.
2. For an Apple computer, open Terminal. If on a Windows machine, open Command Prompt or Windows Terminal. Enter into the folder you made using the command `cd path/to/folder`. To find the path to a folder on a Mac, right click on the folder and press `Get Info`, then select the whole text found under `Where:` and copy with ⌘C. On Windows (not WSL), enter into the folder on File Explorer and click on the path box (located to the left of the search bar), then copy the whole text that shows up.
3. Clone the GitHub repository by entering the following command. Be sure to replace `<YOUR-GITHUB-USERNAME>` with your own username.
```
git clone https://github.com/<YOUR-GITHUB-USERNAME>/Empathetic-Communication.git
```
The code should now be in the folder you created. Navigate into the root folder containing the entire codebase by running the command:
```
cd Empathetic-Communication
```

### Step 2: Upload Secrets

#### You would have to supply your GitHub personal access token you created earlier when deploying the solution. Run the following command and ensure you replace `<YOUR-GITHUB-TOKEN>` and `<YOUR-PROFILE-NAME>` with your actual GitHub token and the appropriate AWS profile name. Select the command corresponding to your operating system from the options below.


<details>
<summary>macOS</summary>

```bash
aws secretsmanager create-secret \
    --name github-personal-access-token \
    --secret-string '{"my-github-token": "<YOUR-GITHUB-TOKEN>"}' \
    --profile <YOUR-PROFILE-NAME>
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
aws secretsmanager create-secret ^
    --name github-personal-access-token ^
    --secret-string "{\"my-github-token\": \"<YOUR-GITHUB-TOKEN>\"}" ^
    --profile <YOUR-PROFILE-NAME>
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
aws secretsmanager create-secret `
    --name github-personal-access-token `
    --secret-string '{"my-github-token": "<YOUR-GITHUB-TOKEN>"}' `
    --profile <YOUR-PROFILE-NAME>
```
</details>

&nbsp;

Moreover, you will need to upload your github username to Amazon SSM Parameter Store. You can do so by running the following command. Make sure you replace `<YOUR-GITHUB-USERNAME>` and `<YOUR-PROFILE-NAME>` with your actual username and the appropriate AWS profile name.


<details>
<summary>macOS</summary>

```bash
aws ssm put-parameter \
    --name "vci-owner-name" \
    --value "<YOUR-GITHUB-USERNAME>" \
    --type String \
    --profile <YOUR-PROFILE-NAME>
```
</details>

<details>
<summary>Windows CMD</summary>

```cmd
aws ssm put-parameter ^
    --name "vci-owner-name" ^
    --value "<YOUR-GITHUB-USERNAME>" ^
    --type String ^
    --profile <YOUR-PROFILE-NAME>
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
aws ssm put-parameter `
    --name "vci-owner-name" `
    --value "<YOUR-GITHUB-USERNAME>" `
    --type String `
    --profile <YOUR-PROFILE-NAME>
```
</details>

&nbsp;

You would have to supply a custom database username when deploying the solution to increase security. Run the following command and ensure you replace `<YOUR-DB-USERNAME>` with the custom name of your choice.

<details>
<summary>macOS</summary>

```bash
aws secretsmanager create-secret \
    --name VCISecrets \
    --secret-string "{\"DB_Username\":\"<YOUR-DB-USERNAME>\"}"\
    --profile <your-profile-name>
```
</details>

<details>
<summary>Windows CMD</summary>

```cmd
aws secretsmanager create-secret ^
    --name VCISecrets ^
    --secret-string "{\"DB_Username\":\"<YOUR-DB-USERNAME>\"}"^
    --profile <your-profile-name>
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
aws secretsmanager create-secret `
    --name VCISecrets `
    --secret-string '{\"DB_Username\":\"<YOUR-DB-USERNAME>\"}' `
    --profile <your-profile-name>
```
</details>

&nbsp;

For example,

```
aws secretsmanager create-secret \
    --name VCISecrets \
    --secret-string '{\"DB_Username\":\"VCISecrets\"}'\
    --profile <your-profile-name>
```

Finally, in order to restrict user sign up to specific email domains, you will need to upload a comma separated list of allowed email domains to Amazon SSM Parameter Store. You can do so by running the following command. Make sure you replace `<YOUR-ALLOWED-EMAIL-DOMAIN-LIST>` and `<YOUR-PROFILE-NAME>` with your actual list and the appropriate AWS profile name.

<details>
<summary>macOS</summary>

```bash
aws ssm put-parameter \
    --name "/VCI/AllowedEmailDomains" \
    --value "<YOUR-ALLOWED-EMAIL-DOMAIN-LIST>" \
    --type SecureString \
    --profile <YOUR-PROFILE-NAME>
```
</details>

<details>
<summary>Windows CMD</summary>

```cmd
aws ssm put-parameter ^
    --name "/VCI/AllowedEmailDomains" ^
    --value "<YOUR-ALLOWED-EMAIL-DOMAIN-LIST>" ^
    --type SecureString ^
    --profile <YOUR-PROFILE-NAME>
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
aws ssm put-parameter `
    --name "/VCI/AllowedEmailDomains" `
    --value "<YOUR-ALLOWED-EMAIL-DOMAIN-LIST>" `
    --type SecureString `
    --profile <YOUR-PROFILE-NAME>
```
</details>

&nbsp;

For example,
```
aws ssm put-parameter \
    --name "/VCI/AllowedEmailDomains" \
    --value "gmail.com,ubc.ca" \
    --type SecureString \
    --profile <YOUR-PROFILE-NAME>
```

#### Step 3a: CDK Deployment with an Existing VPC

The following set of instructions are only if you want to deploy this application with an **existing VPC**. If you do not want to do this you can skip this section.

In order to deploy, you will need to have access to the **aws-controltower-VPC** and the name of your **AWSControlTowerStackSet**.

#### Step-by-Step Instructions

1. **Modify the VPC Stack:**
   - Navigate to the `vpc-stack.ts` file located at `cdk/lib/vpc-stack.ts`.
   - Replace **line 16** with your existing VPC ID:
     ```typescript
     const existingVpcId: string = 'your-vpc-id'; //CHANGE IF DEPLOYING WITH EXISTING VPC
     ```
     You can find your VPC ID by navigating to the **VPC dashboard** in the AWS Management Console and locating the VPC in the `Your VPCs` section.

     ![VPC ID Image](images/ExistingVPCId.png)

2. **Update the AWS Control Tower Stack Set:**
   - Replace **line 19** with your AWS Control Tower Stack Set name:
     ```typescript
     const AWSControlTowerStackSet = "your-stackset-name"; //CHANGE TO YOUR CONTROL TOWER STACK SET
     ```
     You can find this name by navigating to the **CloudFormation dashboard** in AWS, under `Stacks`. Look for a stack name that starts with `StackSet-AWSControlTowerBP-VPC-ACCOUNT-FACTORY`.

     ![AWS Control Tower Stack Image](images/AWSControlTowerStack.png)

  #### Second deployment in the Environment with an Existing VPC:

The following set of instructions are only if this is the second project you are deploying with an **Existing VPC**. If you do not want to do this you can skip this section.

In order to deploy a second project with a pre-existing vpc, you will need to have access to the **Public Subnet ID**.

#### 

### **3. Update the Public Subnet ID and CIDR Range**

To deploy a second project with a pre-existing vpc, you need to obtain an available **Public Subnet ID** and an unused **CIDR range** within the VPC.

#### **Finding the Public Subnet ID**
1. **Navigate to the AWS VPC Console**:  
   - Log in to the AWS Management Console.  
   - Search for and open the **VPC** service.

2. **Locate the Existing Public Subnet**:  
   - In the left-hand menu, click **Subnets**.  
   - Identify the **public subnet** used by your first deployment. You can confirm it is a public subnet by checking if it has a **Route Table** entry pointing to an **Internet Gateway**.

3. **Copy the Subnet ID**:  
   - Once you've identified the correct public subnet, note down its **Subnet ID** for later use.  
   - You will replace the placeholder in your `vpc-stack.ts` file as follows:
     ```typescript
     const existingPublicSubnetID: string = "your-public-subnet-id"; // CHANGE IF DEPLOYING WITH EXISTING PUBLIC SUBNET
     ```

#### **Finding an Available CIDR Range**
AWS subnets within a VPC cannot overlap in CIDR range, so you need to select an unused range that aligns with existing allocations.

1. **Check Existing CIDR Allocations**:  
   - In the **VPC Console**, navigate to **Your VPCs** and find the VPC where your first project was deployed.  
   
2. **Check Used Subnet CIDR Ranges**:  
   - Go to **Subnets** and find all subnets associated with your VPC.  
   - Look at the **CIDR Blocks** of each existing subnet (e.g., `172.31.0.0/20`, `172.31.32.0/20`, etc.).

3. **Determine the Next Available CIDR Block**:  
   - The third number in the CIDR block (e.g., `172.31.XX.0/20`) must be a **multiple of 32** (e.g., `0, 32, 64, 96, 128, 160, 192, 224`).
   - Identify the first unused **/20** block by checking which multiples of 32 are already in use.

4. **Example**:  
   - If the existing subnets are `172.31.0.0/20`, `172.31.32.0/20`, and `172.31.64.0/20`, the next available range should be `172.31.96.0/20`.

5. **Update the `vpc-stack.ts` File**:  
   - Replace the placeholder with the available CIDR block:
     ```typescript
     this.vpcCidrString = "172.31.96.0/20"; // Update based on availability
     ```

By following these steps, you ensure that the new subnet does not overlap with existing ones while maintaining correct alignment with AWS best practices.


You can proceed with the rest of the deployment instructions and the Vpc Stack will automatically use your existing VPC instead of creating a new one. For more detailed information about the deployment with an Existing VPC checkout the [Existing VPC Deployment Guide](/docs/ExistingVPCDeployment.md)

### Step 3: CDK Deployment
It's time to set up everything that goes on behind the scenes! For more information on how the backend works, feel free to refer to the Architecture Deep Dive, but an understanding of the backend is not necessary for deployment.

Open a terminal in the `/cdk` directory.

**Download Requirements**: Install requirements with npm by running `npm install` command.


**Initialize the CDK stack**(required only if you have not deployed any resources with CDK in this region before). Please replace `<your-profile-name>` with the appropriate AWS profile used earlier.
```
cdk synth --profile <your-profile-name>
cdk bootstrap aws://<YOUR_AWS_ACCOUNT_ID>/<YOUR_ACCOUNT_REGION> --profile <your-profile-name>
```

**Deploy CDK stack**
You may run the following command to deploy the stacks all at once. Again, replace `<your-profile-name>` with the appropriate AWS profile used earlier. Also replace `<your-stack-prefix>` with the appropriate stack prefix, and `<your-model-id>` with the selected bedrock model id.
The stack prefix will be prefixed onto the physical names of the resources created during deployment.
If you have trouble running the above command, try removing all the \ and run it in one line.
```
cdk deploy --all \
 --parameters <your-stack-prefix>-Amplify:githubRepoName=EMPATHETIC-COMMUNICATION \
 --context StackPrefix=<your-stack-prefix> \
 --profile <your-profile-name>
```
For example: 
```
cdk deploy --all --parameters Empathetic-Communication-Amplify:githubRepoName=EMPATHETIC-COMMUNICATION --context StackPrefix=Empathetic-Communication --profile <your-profile-name>
```

## Post-Deployment
### Step 1: Build AWS Amplify App

1. Log in to AWS console, and navigate to **AWS Amplify**. You can do so by typing `Amplify` in the search bar at the top.
2. From `All apps`, click `<stack-prefix>-amplify`.
3. Then click `main` under `branches`
4. Click `run job` and wait for the build to complete.
5. You now have access to the `Amplify App ID` and the public domain name to use the web app.

### Step 2: Change Redirects

1. Click back to navigate to `vci-amplify/Overview`
2. In the left side bar click   `Rewrites and Redirects` under `Hosting`
3. Click `manage redirects` on the top right
4. Click `add rewrite`
5. For `Source address` type `</^[^.]+$|.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>`
6. For `Target address` type `/`
7. For `Type` select `404 (Redirect)`
8. Click `Save`

### Step 3: Configure Socket URL

The deployment outputs two load balancer DNS names:
- **ALB DNS Name**: For WebSocket connections (recommended)
- **NLB DNS Name**: For raw TCP connections

Update your Amplify environment variables with the ALB DNS name:

1. In Amplify Console, go to your app → App settings → Environment variables
2. Update or add `VITE_SOCKET_URL` with:
   ```
   ws://socket-alb-xxxxx.us-east-1.elb.amazonaws.com
   ```
3. Redeploy the app

### Step 4: Visit Web App
You can now navigate to the web app URL to see your application in action.

## Cross-Account Access

For multi-account deployments where different AWS accounts need to access this service, see [CROSS_ACCOUNT_DEPLOYMENT.md](./CROSS_ACCOUNT_DEPLOYMENT.md) for detailed setup instructions using:
- **VPC Peering**: Direct network-to-network connectivity
- **AWS PrivateLink**: Private service endpoints
- **VPC Endpoints**: Managed connectivity solution

## Cleanup
### Taking down the deployed stack
To take down the deployed stack for a fresh redeployment in the future, navigate to AWS Cloudformation on the AWS Console, click on the stack and hit Delete.

Please wait for the stacks in each step to be properly deleted before deleting the stack downstream.

Also make sure to delete secrets in Secrets Manager.