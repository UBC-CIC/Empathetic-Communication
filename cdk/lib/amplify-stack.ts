import {
  App,
  BasicAuth,
  GitHubSourceCodeProvider,
  RedirectStatus,
} from "@aws-cdk/aws-amplify-alpha";
import * as cdk from "aws-cdk-lib";
import { BuildSpec } from "aws-cdk-lib/aws-codebuild";
import { Construct } from "constructs";
import * as yaml from "yaml";
import { ApiServiceStack } from "./api-service-stack";
import { EcsSocketStack } from "./ecs-socket-stack";


export class AmplifyStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    apiStack: ApiServiceStack,
    ecsSocketStack: EcsSocketStack,
    apiStackForAppSync: ApiServiceStack, // This is the same as apiStack now
    props?: cdk.StackProps
  ) {
    super(scope, id, props);

    // Define the GitHub repository name as a parameter
    const githubRepoName = new cdk.CfnParameter(this, "githubRepoName", {
      type: "String",
      description: "The name of the GitHub repository",
    }).valueAsString;

    const amplifyYaml = yaml.parse(` 
      version: 1
      applications:
        - appRoot: frontend
          frontend:
            phases:
              preBuild:
                commands:
                  - pwd
                  - nvm install 22
                  - nvm use 22
                  - npm ci
              build:
                commands:
                  - npm run build
            artifacts:
              baseDirectory: dist
              files:
                - '**/*'
            cache:
              paths:
                - 'node_modules/**/*'
    `);

    const username = cdk.aws_ssm.StringParameter.valueForStringParameter(
      this,
      "vci-owner-name"
    );

    const amplifyApp = new App(this, `${id}-amplifyApp`, {
      appName: `${id}-amplify`,
      sourceCodeProvider: new GitHubSourceCodeProvider({
        owner: username,
        repository: githubRepoName,
        oauthToken: cdk.SecretValue.secretsManager(
          "github-personal-access-token",
          {
            jsonField: "my-github-token",
          }
        ),
      }),
      environmentVariables: {
        VITE_AWS_REGION: this.region,
        VITE_COGNITO_USER_POOL_ID: apiStack.getUserPoolId(),
        VITE_COGNITO_USER_POOL_CLIENT_ID: apiStack.getUserPoolClientId(),
        VITE_API_ENDPOINT: apiStack.getEndpointUrl(),
        VITE_IDENTITY_POOL_ID: apiStack.getIdentityPoolId(),
        VITE_SOCKET_URL: ecsSocketStack.socketUrl,
        VITE_APPSYNC_GRAPHQL_URL: apiStack.appSyncApi.graphqlUrl,
      },
      buildSpec: BuildSpec.fromObjectToYaml(amplifyYaml),
    });

    amplifyApp.addCustomRule({
      source:
        "</^[^.]+$|.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
      target: "/",
      status: RedirectStatus.NOT_FOUND_REWRITE,
    });

    amplifyApp.addBranch("main");

    amplifyApp.addBranch("websocket-server");
  }
}
