# Cross-Region Deployment Support

This document outlines the changes made to support deploying the Empathetic Communication app to any AWS region while handling cross-region inference requirements for Nova Sonic and other Bedrock models.

## Key Changes Made

### 1. Nova Sonic Cross-Region Support (`cdk/socket-server/nova_sonic.py`)

- **Separated Nova Sonic region from deployment region**: Nova Sonic requires `us-east-1`, but other Bedrock models can use the deployment region
- **Added deployment region tracking**: `self.deployment_region` stores the actual deployment region
- **Updated Bedrock client calls**: Non-Nova models use deployment region, with fallback to `us-east-1`
- **Added comprehensive fallback logic**: If deployment region fails for Nova models, automatically retry with `us-east-1`

### 2. Text Generation Cross-Region Support (`cdk/text_generation/src/helpers/chat.py`)

- **Added `get_bedrock_client_with_fallback()` helper**: Automatically selects appropriate region based on model type
- **Updated `get_bedrock_llm()`**: Uses deployment region for non-Nova models, `us-east-1` for Nova models
- **Added fallback logic**: Nova Pro evaluation falls back to `us-east-1` if deployment region fails
- **Environment-based region detection**: Uses `AWS_REGION` environment variable for deployment region

### 3. Infrastructure Updates (`cdk/lib/ecs-socket-stack.ts`)

- **Added `AWS_DEFAULT_REGION` environment variable**: Ensures consistent region configuration across all AWS SDK calls
- **Maintained existing `AWS_REGION`**: Preserves compatibility with existing code

## How It Works

### Nova Sonic (Voice AI)
- **Always uses `us-east-1`**: Nova Sonic is only available in `us-east-1`, so the bidirectional stream connection always goes there
- **Cross-region inference**: Other Bedrock model calls (diagnosis, empathy evaluation) try deployment region first, then fall back to `us-east-1`

### Text Generation
- **Smart region selection**: Nova models automatically use `us-east-1`, other models use deployment region
- **Automatic fallback**: If a Nova model fails in deployment region, automatically retries in `us-east-1`

### Deployment Regions Supported
- **Any AWS region**: The app can now be deployed to any region where the required services are available
- **Automatic model routing**: Models are automatically routed to the correct region based on availability

## Benefits

1. **True multi-region support**: Deploy to any AWS region without code changes
2. **Optimal performance**: Non-Nova models use local region for better latency
3. **Automatic failover**: Seamless fallback to `us-east-1` for Nova models when needed
4. **Minimal code changes**: Changes are isolated and don't affect existing functionality
5. **Future-proof**: Easy to add support for new regions as Nova models become available

## Usage

No changes required for deployment. The app will automatically:
1. Detect the deployment region from `AWS_REGION` environment variable
2. Route Nova Sonic to `us-east-1` (required)
3. Route other Bedrock models to deployment region with `us-east-1` fallback
4. Handle cross-region authentication seamlessly

## Testing

Deploy to any region and verify:
1. Nova Sonic voice interactions work correctly
2. Text-based chat uses local region models when available
3. Empathy evaluation works in both deployment region and fallback scenarios
4. No performance degradation for non-Nova model interactions