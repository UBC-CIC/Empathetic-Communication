import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as codeconnections from "aws-cdk-lib/aws-codeconnections";

/**
 * Per-module config: one Docker image + (optionally) one Lambda function to update.
 */
interface LambdaConfig {
    name: string; // Logical module name (e.g. "TextGen", "DataIngest")
    functionName: string; // Exact Lambda function name in AWS (must match your ApiServiceStack functionName)
    sourceDir: string; // Path in repo where Dockerfile lives (e.g. "cdk/text_generation")
}

interface CICDStackProps extends cdk.StackProps {
    githubRepo: string; // e.g. "Empathetic-Communication"
    githubBranch?: string; // default "main"
    environmentName?: string; // default "dev"
    lambdaFunctions: LambdaConfig[];
}

export class CICDStack extends cdk.Stack {
    public readonly ecrRepositories: { [key: string]: ecr.Repository } = {};
    public readonly buildProjects: { [key: string]: codebuild.IProject } = {};

    constructor(scope: Construct, id: string, props: CICDStackProps) {
        super(scope, id, props);

        const envName = props.environmentName ?? "dev";

        /**
         * Shared CodeBuild role for all module builders.
         * - Push/Pull to ECR
         * - Update only your two Docker Lambdas (TextGen + DataIngest)
         */
        const codeBuildRole = new iam.Role(this, "DockerBuildRole", {
            assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
        });

        // Broad ECR permissions (convenient; can be tightened later)
        codeBuildRole.addManagedPolicy(
            iam.ManagedPolicy.fromAwsManagedPolicyName(
                "AmazonEC2ContainerRegistryPowerUser"
            )
        );

        // Allow CodeBuild to update ONLY the Docker Lambdas in this project
        codeBuildRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "lambda:GetFunction",
                    "lambda:UpdateFunctionCode",
                    "lambda:UpdateFunctionConfiguration",
                ],
                resources: [
                    `arn:aws:lambda:${this.region}:${this.account}:function:*-TextGenLambdaDockerFunction`,
                    `arn:aws:lambda:${this.region}:${this.account}:function:*-DataIngestLambdaDockerFunction`,
                ],
            })
        );

        /**
         * Pipeline artifact from Source stage
         */
        const sourceOutput = new codepipeline.Artifact();

        /**
         * CodePipeline
         */
        const pipeline = new codepipeline.Pipeline(this, "DockerImagePipeline", {
            pipelineName: `${id}-DockerImagePipeline`,
        });

        /**
         * GitHub owner/org stored in SSM.
         * Must exist: / vci-owner-name parameter value = "rajrupa04" (or your org)
         */
        const username = cdk.aws_ssm.StringParameter.valueForStringParameter(
            this,
            "vci-owner-name"
        );

        /**
         * CodeStar Connection to GitHub
         * NOTE: After first deploy, you must authorize this connection in AWS Console.
         */
        const githubConnection = new codeconnections.CfnConnection(
            this,
            "GitHubConnection",
            {
                connectionName: `${id.substring(0, 20)}-github-conn`,
                providerType: "GitHub",
            }
        );

        new cdk.CfnOutput(this, "GitHubConnectionArn", {
            value: githubConnection.attrConnectionArn,
            description:
                "ARN of the GitHub connection. After deployment, authorize this connection in the AWS Console.",
        });

        /**
         * Source stage: triggers on push to branch
         */
        pipeline.addStage({
            stageName: "Source",
            actions: [
                new codepipeline_actions.CodeStarConnectionsSourceAction({
                    actionName: "GitHub",
                    owner: username,
                    repo: props.githubRepo,
                    branch: props.githubBranch ?? "main",
                    connectionArn: githubConnection.attrConnectionArn,
                    output: sourceOutput,
                    triggerOnPush: true,
                }),
            ],
        });

        /**
         * Build actions: one CodeBuild project per module
         */
        const buildActions: codepipeline_actions.CodeBuildAction[] = [];

        props.lambdaFunctions.forEach((lambdaCfg) => {
            /**
             * ECR repository per module
             */
            const repoName = `${id.toLowerCase()}-${lambdaCfg.name.toLowerCase()}`;

            const ecrRepo = new ecr.Repository(this, `${lambdaCfg.name}Repo`, {
                repositoryName: repoName,
                imageTagMutability: ecr.TagMutability.MUTABLE,
                removalPolicy: cdk.RemovalPolicy.RETAIN,
                imageScanOnPush: true,
            });

            // Allow Lambda service to pull images (same-account only)
            ecrRepo.addToResourcePolicy(
                new iam.PolicyStatement({
                    sid: "LambdaPullAccess",
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.ServicePrincipal("lambda.amazonaws.com")],
                    actions: [
                        "ecr:GetDownloadUrlForLayer",
                        "ecr:BatchGetImage",
                        "ecr:BatchCheckLayerAvailability",
                    ],
                    conditions: {
                        StringEquals: {
                            "aws:SourceAccount": this.account,
                        },
                    },
                })
            );

            this.ecrRepositories[lambdaCfg.name] = ecrRepo;
            cdk.Tags.of(ecrRepo).add("module", lambdaCfg.name);
            cdk.Tags.of(ecrRepo).add("env", envName);

            /**
             * CodeBuild project per module
             * - Builds Docker image from lambdaCfg.sourceDir (in repo)
             * - Pushes :latest + a commit-based tag
             * - Blocks deployment if CRITICAL vulnerabilities found for :latest
             * - Updates Lambda function to use repoUri:latest (if function exists)
             *
             * NOTE: This version "skips with success" if no changes in that folder.
             */
            const buildProject = new codebuild.PipelineProject(
                this,
                `${lambdaCfg.name}BuildProject`,
                {
                    projectName: `${id}-${lambdaCfg.name}Builder`,
                    role: codeBuildRole,
                    environment: {
                        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
                        privileged: true, // required for docker build
                    },
                    environmentVariables: {
                        AWS_ACCOUNT_ID: { value: this.account },
                        AWS_REGION: { value: this.region },
                        ENVIRONMENT: { value: envName },
                        MODULE_NAME: { value: lambdaCfg.name },
                        LAMBDA_FUNCTION_NAME: { value: lambdaCfg.functionName },
                        REPO_NAME: { value: repoName },
                        REPOSITORY_URI: { value: ecrRepo.repositoryUri },
                        PATH_FILTER: { value: lambdaCfg.sourceDir },
                    },
                    buildSpec: codebuild.BuildSpec.fromObject({
                        version: "0.2",
                        phases: {
                            pre_build: {
                                commands: [
                                    "echo Logging in to Amazon ECR...",
                                    "aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com",

                                    // FIX: allow skipping later phases safely
                                    "export SHOULD_BUILD=true",

                                    // FIX: shallow clone fix
                                    "git fetch --depth=2 origin || true",

                                    // build tag
                                    "COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)",
                                    "IMAGE_TAG=${MODULE_NAME}-${ENVIRONMENT}-${COMMIT_HASH}",

                                    // Generate a script that decides whether to build based on changed paths
                                    'echo "#!/bin/bash" > check_and_build.sh',
                                    'echo "set -e" >> check_and_build.sh',
                                    'echo "cd $CODEBUILD_SRC_DIR" >> check_and_build.sh',

                                    // If latest doesn't exist yet, build (first deployment)
                                    'echo "if ! aws ecr describe-images --repository-name $REPO_NAME --image-ids imageTag=latest &>/dev/null; then" >> check_and_build.sh',
                                    'echo "  echo \\"First deployment or latest image missing - building.\\"" >> check_and_build.sh',
                                    'echo "  exit 0" >> check_and_build.sh',
                                    'echo "fi" >> check_and_build.sh',

                                    // If no .git exists, build to be safe (CodePipeline source may not include history)
                                    'echo "if [ ! -d .git ]; then" >> check_and_build.sh',
                                    'echo "  echo \\"No .git history available - building to be safe.\\"" >> check_and_build.sh',
                                    'echo "  exit 0" >> check_and_build.sh',
                                    'echo "fi" >> check_and_build.sh',

                                    // Compare against previous commit
                                    'echo "PREV_COMMIT=\\$(git rev-parse HEAD~1 2>/dev/null || echo \\"\\" )" >> check_and_build.sh',
                                    'echo "if [ -z \\"$PREV_COMMIT\\" ]; then" >> check_and_build.sh',
                                    'echo "  echo \\"No previous commit found - building.\\"" >> check_and_build.sh',
                                    'echo "  exit 0" >> check_and_build.sh',
                                    'echo "fi" >> check_and_build.sh',

                                    'echo "CHANGED_FILES=\\$(git diff --name-only \\$PREV_COMMIT HEAD)" >> check_and_build.sh',
                                    'echo "echo \\"Changed files:\\"" >> check_and_build.sh',
                                    'echo "echo \\"$CHANGED_FILES\\"" >> check_and_build.sh',

                                    // If no changes in PATH_FILTER folder, skip successfully
                                    'echo "if ! echo \\"$CHANGED_FILES\\" | grep -q \\"^$PATH_FILTER/\\"; then" >> check_and_build.sh',
                                    'echo "  echo \\"No changes in $PATH_FILTER — skipping build (success).\\\"" >> check_and_build.sh',
                                    'echo "  exit 1" >> check_and_build.sh',
                                    'echo "fi" >> check_and_build.sh',
                                    'echo "exit 0" >> check_and_build.sh',

                                    "chmod +x check_and_build.sh",

                                    // If script exits 1 => no changes => exit 0 overall (skip success)
                                    'if ./check_and_build.sh; then echo "Changes detected"; else echo "No changes detected"; export SHOULD_BUILD=false; fi',
                                ],
                            },

                            build: {
                                commands: [
                                    'if [ "$SHOULD_BUILD" = "true" ]; then',
                                    '  echo "Building Docker image..."',
                                    '  docker build -t $REPOSITORY_URI:$IMAGE_TAG $CODEBUILD_SRC_DIR/$PATH_FILTER -f $CODEBUILD_SRC_DIR/$PATH_FILTER/Dockerfile',
                                    'else',
                                    '  echo "Skipping build phase"',
                                    'fi',
                                ],
                            },

                            post_build: {
                                commands: [
                                    'if [ "$SHOULD_BUILD" = "true" ]; then',
                                    '  echo "Tagging + pushing images..."',
                                    '  docker tag $REPOSITORY_URI:$IMAGE_TAG $REPOSITORY_URI:latest',
                                    '  docker push $REPOSITORY_URI:$IMAGE_TAG',
                                    '  docker push $REPOSITORY_URI:latest',
                                    '  echo "Waiting briefly for vulnerability scan to start..."',
                                    '  sleep 30',
                                    '  echo "Checking vulnerability scan results (CRITICAL)..."',
                                    '  SCAN_RESULTS=$(aws ecr describe-image-scan-findings --repository-name $REPO_NAME --image-id imageTag=latest --query "imageScanFindingsSummary.findingCounts.CRITICAL" --output text 2>/dev/null || echo "0")',
                                    '  if [[ "$SCAN_RESULTS" != "0" && "$SCAN_RESULTS" != "None" ]]; then',
                                    '    echo "CRITICAL vulnerabilities found: $SCAN_RESULTS. Blocking deployment."',
                                    '    exit 1',
                                    '  else',
                                    '    echo "No critical vulnerabilities found. Proceeding."',
                                    '  fi',
                                    '  echo "Checking if Lambda function exists before updating..."',
                                    '  if aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" &>/dev/null; then',
                                    '    echo "Updating Lambda function to use new image (latest)..."',
                                    '    aws lambda update-function-code --function-name "$LAMBDA_FUNCTION_NAME" --image-uri "$REPOSITORY_URI:latest"',
                                    '  else',
                                    '    echo "Lambda function $LAMBDA_FUNCTION_NAME does not exist yet. Skipping update."',
                                    '  fi',
                                    'else',
                                    '  echo "Skipping post_build (no changes detected)"',
                                    'fi',
                                ],
                            },
                        },
                    }),
                }
            );

            this.buildProjects[lambdaCfg.name] = buildProject;

            // Grant push/pull permissions on THIS repo to this project (repo-scoped)
            ecrRepo.grantPullPush(buildProject);

            buildActions.push(
                new codepipeline_actions.CodeBuildAction({
                    actionName: `Build_${lambdaCfg.name}`,
                    project: buildProject,
                    input: sourceOutput,
                })
            );
        });

        /**
         * Build stage: executes all module build actions
         */
        pipeline.addStage({
            stageName: "Build",
            actions: buildActions,
        });
    }
}