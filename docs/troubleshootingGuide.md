# Troubleshooting Guide

## Network Connectivity Issues

### Lambda Cannot Connect to RDS

**Symptoms:**
- DBFlow stack fails during deployment
- Error: `Error: connect ETIMEDOUT <IP>:5432`
- Lambda function times out when trying to connect to database

**Diagnosis Steps:**

1. **Check VPC CIDR Configuration:**
   ```bash
   # Get all CIDR blocks associated with your VPC
   aws ec2 describe-vpcs --vpc-ids <vpc-id> \
     --query "Vpcs[0].CidrBlockAssociationSet" \
     --profile <your-profile>
   ```
   
   Look for multiple CIDR blocks. Your VPC may have:
   - Primary CIDR (e.g., `10.102.252.160/27`)
   - Secondary CIDR (e.g., `10.102.0.0/25`)

2. **Verify Subnet CIDR Ranges:**
   ```bash
   # Check which CIDR block contains your subnets
   aws ec2 describe-subnets --subnet-ids <subnet-id-1> <subnet-id-2> \
     --query "Subnets[*].[SubnetId,CidrBlock]" \
     --output table --profile <your-profile>
   ```

3. **Check RDS Security Group Rules:**
   ```bash
   # Get RDS security group
   aws rds describe-db-instances \
     --query "DBInstances[0].VpcSecurityGroups[*].VpcSecurityGroupId" \
     --output text --profile <your-profile>
   
   # Check security group ingress rules
   aws ec2 describe-security-groups --group-ids <sg-id> \
     --query "SecurityGroups[0].IpPermissions" \
     --profile <your-profile>
   ```

**Solution:**

Ensure the VPC CIDR in `cdk/lib/vpc-stack.ts` matches the CIDR block that contains your subnets:

```typescript
// If subnets are 10.102.0.64/27 and 10.102.0.96/27
// Use the parent CIDR that contains them:
this.vpcCidrString = "10.102.0.0/25"; // NOT "10.102.252.160/27"
```

The database security group rule must allow traffic from this CIDR range for Lambda to connect successfully.

### VPC CIDR Mismatch

**Problem:** Resources in different subnets cannot communicate even though security groups are correctly configured.

**Root Cause:** The VPC CIDR configured in CDK doesn't match the actual CIDR block where subnets are located.

**How VPCs Can Have Multiple CIDRs:**
- AWS allows associating multiple CIDR blocks to a single VPC
- The primary CIDR is set at VPC creation
- Secondary CIDRs can be added later to expand the IP address space
- Subnets can be created in any associated CIDR block

**Solution:**
1. List all CIDR blocks: `aws ec2 describe-vpcs --vpc-ids <vpc-id>`
2. Identify which CIDR contains your subnets
3. Update `this.vpcCidrString` in `vpc-stack.ts` to use that CIDR
4. Redeploy the Database and VPC stacks to update security group rules

### Security Group Configuration

**Verifying Security Group Rules:**

```bash
# Check Lambda security group
aws lambda get-function --function-name <function-name> \
  --query "Configuration.VpcConfig.SecurityGroupIds" \
  --profile <your-profile>

# Check what the Lambda SG allows
aws ec2 describe-security-groups --group-ids <lambda-sg-id> \
  --query "SecurityGroups[0].IpPermissionsEgress" \
  --profile <your-profile>

# Verify RDS allows Lambda's subnet CIDR
aws ec2 describe-security-groups --group-ids <rds-sg-id> \
  --query "SecurityGroups[0].IpPermissions" \
  --profile <your-profile>
```

**Expected Configuration:**
- RDS security group should have ingress rule allowing port 5432 from VPC CIDR
- Lambda needs ENI (Elastic Network Interface) in the same VPC
- Network ACLs should allow bidirectional traffic (default allows all)

## Deployment Issues

### RDS Service-Linked Role Missing

**Symptoms:**
- Database stack fails with status code 403
- Error: `RDS is not authorized to assume service-linked role arn:aws:iam::<account>:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS`

**Cause:** First-time RDS deployment in the AWS account requires creating a service-linked role.

**Solution:**

```bash
# Create the service-linked role
aws iam create-service-linked-role \
  --aws-service-name rds.amazonaws.com \
  --profile <your-profile>

# Verify it was created
aws iam get-role \
  --role-name AWSServiceRoleForRDS \
  --profile <your-profile>
```

After creating the role, redeploy the stack:
```bash
cd cdk
npx cdk deploy Empath-AI-Database --profile <your-profile>
```

### Stack Rollback States

**Problem:** Cannot update a stack that's in `ROLLBACK_COMPLETE` or `ROLLBACK_IN_PROGRESS` state.

**Solution:**

```bash
# Wait for rollback to complete if in progress
aws cloudformation wait stack-rollback-complete \
  --stack-name <stack-name> \
  --profile <your-profile>

# Delete the failed stack
aws cloudformation delete-stack \
  --stack-name <stack-name> \
  --profile <your-profile>

# Wait for deletion
aws cloudformation wait stack-delete-complete \
  --stack-name <stack-name> \
  --profile <your-profile>

# Redeploy
cd cdk
npx cdk deploy <stack-name> --profile <your-profile>
```

### SQL Migration Errors

**Symptoms:**
- DBFlow stack fails with: `Error: syntax error at or near "s"`
- Migration Lambda completes but with SQL errors

**Common Causes:**
1. **Improper variable interpolation in PostgreSQL `format()` statements**
2. **Missing escape sequences for special characters**
3. **Nested string interpolation in DO blocks**

**Example Fix:**

❌ **Incorrect:**
```javascript
const sql = `
  DO $$
  BEGIN
    EXECUTE format('CREATE USER ${USERNAME} WITH PASSWORD %L', '${password}');
  END$$;
`;
```

✅ **Correct:**
```javascript
const sql = `
  DO $$
  DECLARE
    pwd TEXT := '${password}';
  BEGIN
    EXECUTE format('CREATE USER %I WITH PASSWORD %L', '${USERNAME}', pwd);
  END$$;
`;
```

**Key Points:**
- Use `%I` for identifiers (table/column names)
- Use `%L` for literal values (strings/passwords)
- Declare variables in `DECLARE` block to avoid nested interpolation
- Test SQL directly in psql before deploying

## Table of Contents
- [Troubleshooting Guide](#troubleshooting-guide)
  - [Network Connectivity Issues](#network-connectivity-issues)
    - [Lambda Cannot Connect to RDS](#lambda-cannot-connect-to-rds)
    - [VPC CIDR Mismatch](#vpc-cidr-mismatch)
    - [Security Group Configuration](#security-group-configuration)
  - [Deployment Issues](#deployment-issues)
    - [RDS Service-Linked Role Missing](#rds-service-linked-role-missing)
    - [Stack Rollback States](#stack-rollback-states)
    - [SQL Migration Errors](#sql-migration-errors)
  - [SageMaker Notebook for Troubleshooting](#sagemaker-notebook-for-troubleshooting)
    - [Motivation](#motivation)
    - [Creating Notebook Instance](#creating-notebook-instance)
    - [Connecting to RDS](#connecting-to-rds)
    - [Checking Embeddings](#checking-embeddings)
  - [Docker Issues](#docker-issues)
    - [Overview](#overview)
    - [Fixing Docker Login Error](#fixing-docker-login-error)

## SageMaker Notebook for Troubleshooting

### Motivation
Using an AWS SageMaker Notebook instance allows you to quickly experiment with and debug services like RDS, Bedrock, and other AWS resources without deploying your code to a Lambda function or EC2 instance. It also provides a terminal and notebook interface for issuing database queries, running Python scripts, and testing models interactively. This is especially useful for debugging, inspecting embeddings, or verifying if documents are being ingested properly into your system.

---

### Creating Notebook Instance

1. **Navigate to SageMaker Notebooks**  
   Go to AWS SageMaker in the AWS Console, and click **Notebooks** from the sidebar.

2. **Click "Create notebook instance"**  
   Click the orange **Create notebook instance** button.

3. **Fill in Notebook instance settings**
   - In the **Notebook instance name** box, enter a meaningful name (e.g., `debug-notebook`).
   - Choose an appropriate **Notebook instance type**. Smaller types (e.g., `ml.t2.medium`) work for light queries. Use larger types for running ML models.
   - Select a **Platform identifier** based on your use case and region.

4. **Set Permissions and Encryption**
   - Under **IAM role**, you can either let AWS create a new role or select an existing one.
   - If you let AWS create the role, you can later modify its permissions in the **IAM** console to include access to Bedrock, S3, or RDS.

5. **Configure Network (if connecting to private services like RDS)**
   - Select a **VPC**.
   - Choose a **subnet**:
     - Open a new tab and go to **RDS**.
     - Select your database, then look at the **Connectivity & security** panel.
     - Copy one of the **subnets** and paste it in the notebook's **Subnet** field.
   - For **Security groups**:
     - In the same RDS panel, find the associated **security group(s)**.
     - Copy and paste them into the **Security groups** field in SageMaker.

6. **Click "Create notebook instance"**  
   This process may take several minutes. Once the status changes to "InService", your instance is ready.

---

### Connecting to RDS

1. **Open JupyterLab**
   - Click the **Open JupyterLab** button once the instance is running. It will open a new tab.

2. **Open Terminal**
   - In JupyterLab, click **Terminal** to open a shell.
   - Paste the following commands to install required PostgreSQL dependencies:

     ```bash
     sudo amazon-linux-extras install epel && \
     sudo amazon-linux-extras install postgresql10 && \
     sudo yum install -y postgresql postgresql-server && \
     pip3 install --force-reinstall psycopg2==2.9.3
     ```

   - **Explanation**:
     - The first two lines enable and install the PostgreSQL extras repo.
     - The third installs PostgreSQL client tools.
     - The fourth installs the `psycopg2` Python library for interacting with PostgreSQL.
   - Follow prompts and accept any permissions or confirmations.

3. **Retrieve Database Credentials**
   - Open **Secrets Manager** in another tab.
   - Click on the secret named `VCI-staging-DatabaseStack-VCI/credentials/rdsDbCredential`.
   - Click **Retrieve secret value** to reveal your database credentials.

4. **Connect Using `psql`**
   - Format the following command with the retrieved values:

     ```bash
     psql -h <host> -p <port> -d <dbname> -U <username>
     ```

   - Paste the command into the terminal. When prompted for a password, paste the copied password.
   - **Note**: No characters will appear when pasting the password—this is normal.
   - If successful, the prompt will change from `sh-4.2$` to something like `vci=>`.

5. **Inspect Tables**
   - Type the following command in the terminal to list all tables:

     ```sql
     \dt
     ```

   - From here, you can run SQL queries to check or manipulate data in your RDS PostgreSQL database.

---

### Checking Embeddings

In this section, you will learn how to check whether document embeddings have been correctly generated and stored in the database.  
Embeddings are organized into **collections**, and each collection corresponds to a **patient** inside a **simulation group**.  
To verify that embeddings are properly created, you first need to find the right patient inside a simulation group. Once you have the patient IDs, you can check the associated collections to make sure embeddings are present.

---

1. **View all simulation group IDs and names**
   - First, you need to see all the simulation groups to know which the group of patients you would like to inspect.

   - Paste the following SQL command into your database terminal:

     ```sql
     SELECT simulation_group_id, group_name
     FROM "simulation_groups";
     ```

   - Use the simulation_group_id to fetch associated patients in the next step.

---

2. **View All Patients in a Simulation Group**
   - Now that you have the simulation group IDs, you can view all the patients in it.

   - Paste the following command:

     ```sql
     SELECT patient_id, patient_name
     FROM "patients"
     WHERE simulation_group_id = '<your_simulation_group_id>';
     ```

   - Replace `<your_simulation_group_idd>` with the actual ID from the previous step.

---

3. **View embedding collections**
   - You can now view the collections stored in your project.

   - To see **all collections** in the project:

     ```sql
     SELECT * FROM langchain_pg_collection;
     ```

   - To see **only the collections related to a specific simulation group**:

     ```sql
     SELECT lpc.uuid, lpc.name
     FROM langchain_pg_collection lpc
     WHERE lpc.name IN (
         SELECT patient_id::text
         FROM "patients"
         WHERE simulation_group_id = '<your_simulation_group_id>'
     );
     ```

   - Replace `<your_simulation_group_idd>` with the simulation group ID you retrieved earlier.

   - **Notes:**
     - The collection names should match the patient IDs from Step 2.
     - The number of collections shown should match the number of patients you saw earlier.
     - Each collection corresponds to one patient.

---

4. **Check number of embeddings in a collection**
   - Finally, you can check how many embeddings exist for each patient (collection).

   - To check the number of embeddings for a specific patient, use:

     ```sql
     SELECT COUNT(*)
     FROM langchain_pg_embedding e
     JOIN langchain_pg_collection c ON e.collection_id = c.uuid
     WHERE c.name = '<patient_id or name of collection>';
     ```

   - Replace `<patient_id or name of collection>` with the patient ID or collection name you want to inspect.

   - This will return a **single number** representing how many embeddings (pieces of information) are stored for that patient.

   - **Example:**
     - If you added documents into the patient through the web app, you should see the number go **up**.
     - If you delete documents from the patient, the number should **go down**.

   - If you want to see the **total number of embeddings** across the entire project (all patients combined), use:

     ```sql
     SELECT COUNT(*) 
     FROM langchain_pg_embedding;
     ```

   - This total embedding count is helpful for verifying the overall ingestion health of your database.

## Docker Issues

### Docker BuildKit and Lambda Compatibility

**Symptoms:**
- Lambda deployment fails with error: `The image manifest, config or layer media type for the source image ... is not supported`
- Error code: 400, InvalidRequest
- Occurs when deploying Lambda functions with Docker containers

**Cause:**
Docker Desktop 28.x and newer versions default to using BuildKit with OCI image format, which creates manifest lists that AWS Lambda doesn't support. Lambda requires Docker manifest v2 schema 2 format.

**Solution:**

Set environment variables before running CDK deploy to disable BuildKit:

**PowerShell:**
```powershell
$env:DOCKER_BUILDKIT=0
$env:DOCKER_CLI_HINTS="false"

# Then deploy
cd cdk
npx cdk deploy --all --profile <your-profile>
```

**Bash/macOS:**
```bash
export DOCKER_BUILDKIT=0
export DOCKER_CLI_HINTS=false

# Then deploy
cd cdk
npx cdk deploy --all --profile <your-profile>
```

**Alternative: Create a permanent Docker config**

Create or edit `~/.docker/config.json` (Windows: `%USERPROFILE%\.docker\config.json`):
```json
{
  "features": {
    "buildkit": false
  }
}
```

**Verification:**

After deployment starts, you should see Docker build output without BuildKit messages. Successful deployment will show:
- Docker images building without "[buildkit]" prefix in logs
- Lambda functions creating successfully
- No manifest media type errors

**Note:** This issue affects:
- `DataIngestLambdaDockerFunction` (data_ingestion)
- `TextGenerationLambdaDockerFunction` (text_generation)  
- Any other Lambda functions using container images

### Overview

Docker is used in this project to run two important workflows in the RAG pipeline using AWS Lambda container images:

- **Text Generation**: This Lambda function runs a container image from the `./text_generation` folder to handle prompt processing, document retrieval, and Bedrock LLM generation.
- **Data Ingestion**: This Lambda function uses the `./data_ingestion` folder to process and embed uploaded documents into the vector store.

Both Lambda functions are defined in the CDK using `lambda.DockerImageFunction` and are built as Docker images pushed to AWS Elastic Container Registry (ECR).

> **Note**: You do **not** need to sign into the Docker Desktop app itself. These images are built and uploaded automatically through CDK during deployment.

However, you may encounter Docker login issues when the CDK attempts to push images to ECR.

---

### Fixing Docker Login Error

#### Common Error Message

You may see this error during deployment:

```
fail: docker login --username AWS --password-stdin https://<your-account-id>.dkr.ecr.ca-central-1.amazonaws.com exited with error code 1: Error saving credentials: error storing credentials - err: exit status 1, out: error storing credentials - err: exit status 1, out: The stub received bad data.`
```

This usually happens because Docker is trying to save credentials using a method or system integration that is broken (for example, Docker Desktop's credential helper).

---

#### How to Fix It

##### 1. Locate Docker Config File

Go to this path on your computer:
```
C:\Users<your-username>.docker\config.json
```

---

##### 2. Verify the File Structure

Your `config.json` file should look similar to this (with account IDs anonymized):

```json
{
  "auths": {
    "<account-ID-1>.dkr.ecr.ca-central-1.amazonaws.com": {},
    "<account-ID-2>.dkr.ecr.ca-central-1.amazonaws.com": {},
    "<account-ID-3>.dkr.ecr.us-west-2.amazonaws.com": {}
  },
  "credsStore": "desktop",
  "currentContext": "desktop-linux",
  "plugins": {
    "-x-cli-hints": {
      "enabled": "true"
    }
  },
  "features": {
    "hooks": "true"
  }
}
```

- Make sure the `auths` section includes your AWS Account ID followed by `.dkr.ecr.ca-central-1.amazonaws.com.`
- If it is missing, manually add the following line (replace `<your-account-id>` with your actual AWS Account ID):
```
"<your-account-id>.dkr.ecr.ca-central-1.amazonaws.com": {},
```

- Save the file after making changes.

---

##### 3. Manually Log In to ECR

Run the following command in your terminal or PowerShell to authenticate Docker with ECR:

```
aws ecr get-login-password --region ca-central-1 | docker login --username AWS --password-stdin <your-account-id>.dkr.ecr.ca-central-1.amazonaws.com
```

- Replace `<your-account-id>` with your actual AWS Account ID.

This command retrieves a temporary login token and uses it to authenticate your Docker client with ECR.
If the command succeeds, your Docker image deployments through CDK should now work properly without further login errors.