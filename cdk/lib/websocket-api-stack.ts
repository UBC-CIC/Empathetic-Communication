import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';

export class WebSocketApiStack extends cdk.Stack {
  public readonly webSocketApiEndpoint: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create WebSocket API
    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'TextGenStreamingApi', {
      apiName: 'TextGenStreamingApi',
      routeSelectionExpression: '$request.body.action',
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', 
          new lambda.Function(this, 'ConnectHandler', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'websocket-connect.handler',
            code: lambda.Code.fromAsset('lambda/websocket'),
            timeout: Duration.seconds(30),
          })
        )
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration',
          new lambda.Function(this, 'DisconnectHandler', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'websocket-disconnect.handler',
            code: lambda.Code.fromAsset('lambda/websocket'),
            timeout: Duration.seconds(30),
          })
        )
      },
    });

    // Add route for text generation streaming
    const streamHandler = new lambda.Function(this, 'StreamHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'websocket-stream.handler',
      code: lambda.Code.fromAsset('lambda/websocket'),
      timeout: Duration.seconds(300),
      environment: {
        // Add environment variables as needed
        REGION: this.region,
      },
    });

    // Grant permissions to invoke Bedrock
    streamHandler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream'
        ],
        resources: ['*'],
      })
    );

    // Add route for streaming
    webSocketApi.addRoute('stream', {
      integration: new WebSocketLambdaIntegration('StreamIntegration', streamHandler),
    });

    // Deploy the API
    const webSocketStage = new apigatewayv2.WebSocketStage(this, 'Stage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant permissions to manage connections
    const connectionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'execute-api:ManageConnections'
      ],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/POST/@connections/*`
      ],
    });

    streamHandler.addToRolePolicy(connectionPolicy);

    // Output the WebSocket URL
    this.webSocketApiEndpoint = webSocketStage.url;
    new cdk.CfnOutput(this, 'WebSocketApiEndpoint', {
      value: this.webSocketApiEndpoint,
      description: 'WebSocket API Endpoint',
      exportName: `${id}-WebSocketApiEndpoint`,
    });
  }
}