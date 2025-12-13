# Cross-Account Access Architecture

## Overview

The updated deployment model removes CloudFront and public IPs, replacing them with private load balancers that enable secure cross-account and cross-VPC access. This provides better security, cost efficiency, and flexibility for multi-account deployments.

## Architecture Changes

### Previous Architecture
- ❌ CloudFront distribution (public internet-facing)
- ❌ ECS tasks assigned public IPs
- ❌ NLB with public internet-facing exposure
- Limited cross-account capability

### New Architecture
- ✅ **Network Load Balancer (NLB)** - Private, TCP-optimized for cross-VPC/cross-account access
- ✅ **Application Load Balancer (ALB)** - Private, HTTP/WebSocket protocol support
- ✅ **ECS Tasks in Private Subnets** - No public IPs, full VPC egress through NAT
- ✅ **VPC Peering/PrivateLink Ready** - Designed for secure inter-account connectivity
- ✅ **Cost Optimized** - Eliminated CloudFront (potential $0.085 per GB egress savings)

## Load Balancer Details

### Network Load Balancer (NLB)
- **Protocol**: TCP (Layer 4)
- **Deployment**: Private subnets in deploying VPC
- **DNS Export**: `{StackName}-NLB-DNS`
- **Use Cases**:
  - Raw TCP connections from other VPCs
  - VPC Peering scenarios
  - AWS PrivateLink endpoints
  - Ultra-low latency requirements

**DNS Name Format**:
```
socket-nlb-[random].us-east-1.elb.amazonaws.com
```

### Application Load Balancer (ALB)
- **Protocol**: HTTP (Layer 7) with WebSocket support
- **Deployment**: Private subnets in deploying VPC
- **DNS Export**: `{StackName}-ALB-DNS`
- **Use Cases**:
  - WebSocket connections (ws://)
  - HTTP upgrade headers
  - Path-based routing
  - Standard client-server communication

**DNS Name Format**:
```
socket-alb-[random].us-east-1.elb.amazonaws.com
```

## Cross-Account Access Setup

### Option 1: VPC Peering

#### Step 1: Create VPC Peering Connection
In the **consuming account** (different AWS account):

```bash
# From consuming account, initiate peering request
aws ec2 create-vpc-peering-connection \
  --vpc-id vpc-consumer-12345 \
  --peer-vpc-id vpc-provider-67890 \
  --peer-owner-id PROVIDER_ACCOUNT_ID \
  --region us-east-1
```

#### Step 2: Accept Peering Connection
In the **provider account** (deployment account):

```bash
# Accept the peering connection
aws ec2 accept-vpc-peering-connection \
  --vpc-peering-connection-id pcx-1234567 \
  --region us-east-1
```

#### Step 3: Update Route Tables
**In provider account** - Add route in private subnet route tables:

```bash
# Route consumer VPC traffic to peering connection
aws ec2 create-route \
  --route-table-id rtb-provider-12345 \
  --destination-cidr-block 10.1.0.0/16 \
  --vpc-peering-connection-id pcx-1234567
```

**In consumer account** - Add route in route tables:

```bash
# Route to provider's load balancers via peering
aws ec2 create-route \
  --route-table-id rtb-consumer-67890 \
  --destination-cidr-block 10.0.0.0/16 \
  --vpc-peering-connection-id pcx-1234567
```

#### Step 4: Update Security Groups
**In provider account** - Allow consumer VPC traffic:

```bash
# Update NLB/ALB security groups
aws ec2 authorize-security-group-ingress \
  --group-id sg-nlb-12345 \
  --protocol tcp \
  --port 80 \
  --cidr 10.1.0.0/16 \
  --description "Allow consumer VPC access"
```

#### Step 5: Access from Consumer Account
In consuming account VPC:

```javascript
// WebSocket connection over VPC peering
const ws = new WebSocket('ws://socket-alb-xxxxx.us-east-1.elb.amazonaws.com:80');

// Or TCP connection
const net = require('net');
const socket = net.createConnection({
  host: 'socket-nlb-xxxxx.us-east-1.elb.amazonaws.com',
  port: 80
});
```

### Option 2: AWS PrivateLink

#### Step 1: Create PrivateLink Endpoint Service
In **provider account**:

```bash
# Create endpoint service from NLB
aws ec2 create-vpc-endpoint-service-configuration \
  --network-load-balancer-arns arn:aws:elasticloadbalancing:us-east-1:ACCOUNT_ID:loadbalancer/net/socket-nlb-xxxxx \
  --acceptance-required false
```

#### Step 2: Enable PrivateLink in Endpoint Service
```bash
aws ec2 modify-vpc-endpoint-service-permissions \
  --service-name com.amazonaws.vpce.us-east-1.vpce-svc-xxxxxx \
  --add-allowed-principals arn:aws:iam::CONSUMER_ACCOUNT_ID:root
```

#### Step 3: Create VPC Endpoint in Consumer Account
In **consumer account**:

```bash
# Create PrivateLink endpoint
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-consumer-12345 \
  --service-name com.amazonaws.vpce.us-east-1.vpce-svc-xxxxxx \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-consumer-11111 subnet-consumer-22222
```

#### Step 4: Access from Consumer Account
```javascript
// Retrieve PrivateLink endpoint DNS
const endpointDns = 'vpce-xxxxxx-xxxxx.us-east-1.vpce.amazonaws.com';

// Connect via PrivateLink
const ws = new WebSocket(`ws://${endpointDns}:80`);
```

### Option 3: AWS Systems Manager Session Manager (Testing)

For quick testing without networking changes:

```bash
# SSM port forwarding from consumer account
aws ssm start-session \
  --target i-ec2-instance-in-provider-vpc \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":"80","localPortNumber":"8080"}'

# Then access locally
const ws = new WebSocket('ws://localhost:8080');
```

## Security Groups Configuration

### Default Security Group Rules

The CDK automatically creates security groups allowing:
- **Inbound**: 10.0.0.0/8 (RFC 1918 private IP range)
- **Outbound**: All traffic to service

### Custom Configuration

Update in CDK before deployment:

```typescript
// In ecs-socket-stack.ts
albSecurityGroup.addIngressRule(
  ec2.Peer.ipv4("10.1.0.0/16"), // Your consumer VPC CIDR
  ec2.Port.tcp(80),
  "Allow consumer account WebSocket access"
);
```

## Network Architecture Diagram

```
┌─────────────────────────────────────────┐
│   PROVIDER ACCOUNT (Deployment)         │
│   VPC: 10.0.0.0/16                      │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐  │
│  │  Private Subnets                 │  │
│  │  ├─ ECS Tasks (no public IPs)    │  │
│  │  │  └─ Port 80                   │  │
│  │  │                               │  │
│  │  ├─ NLB (Private)                │  │
│  │  │  └─ TCP/80 listener           │  │
│  │  │                               │  │
│  │  └─ ALB (Private)                │  │
│  │     └─ HTTP/80 listener          │  │
│  └──────────────────────────────────┘  │
│         ↑                               │
│         │ VPC Peering or PrivateLink   │
│         ↓                               │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│   CONSUMER ACCOUNT                      │
│   VPC: 10.1.0.0/16                      │
├─────────────────────────────────────────┤
│                                         │
│  Application/Client                     │
│  Connects to:                           │
│  • ws://socket-alb-xxxxx.elb.../       │
│  • ws://vpce-xxxxx.vpce.../  (PrivateLink)
│                                         │
└─────────────────────────────────────────┘
```

## CDK Stack Outputs

After deployment, the stack outputs include:

```
NetworkLoadBalancerDnsName: socket-nlb-xxxxx.us-east-1.elb.amazonaws.com
NetworkLoadBalancerArn: arn:aws:elasticloadbalancing:us-east-1:ACCOUNT_ID:loadbalancer/net/socket-nlb-xxxxx

ApplicationLoadBalancerDnsName: socket-alb-xxxxx.us-east-1.elb.amazonaws.com
ApplicationLoadBalancerArn: arn:aws:elasticloadbalancing:us-east-1:ACCOUNT_ID:loadbalancer/app/socket-alb-xxxxx

InternalWebSocketUrl: ws://socket-alb-xxxxx.us-east-1.elb.amazonaws.com
```

## Migration from CloudFront

### What Changed
1. **Remove CloudFront Dependency**: No more geo-distribution, lower latency within VPC region
2. **Direct LB Access**: Direct connectivity via private network instead of internet
3. **Protocol**: WebSocket now uses `ws://` instead of `wss://` (use TLS at application layer if needed)

### Frontend Configuration Updates

**Before (CloudFront)**:
```javascript
const SOCKET_URL = 'wss://d123.cloudfront.net';
```

**After (Private ALB)**:
```javascript
// From same VPC (direct)
const SOCKET_URL = 'ws://socket-alb-xxxxx.us-east-1.elb.amazonaws.com';

// From different VPC (via peering/PrivateLink)
const SOCKET_URL = 'ws://socket-alb-xxxxx.us-east-1.elb.amazonaws.com'; // Same DNS
```

**Amplify Configuration**:
```javascript
// In Amplify stack, update environment variable
VITE_SOCKET_URL: 'ws://socket-alb-xxxxx.us-east-1.elb.amazonaws.com'
```

## Troubleshooting

### Connection Issues

**Symptom**: Cannot connect to load balancer from consumer VPC

**Solutions**:
1. Verify VPC peering is ACTIVE
2. Check route table entries in both VPCs
3. Validate security group rules allow consumer CIDR
4. Test connectivity: `telnet socket-alb-xxxxx.elb.amazonaws.com 80`

### Latency

**Issue**: High latency across accounts

**Solutions**:
- Use NLB (Layer 4) instead of ALB (Layer 7) for raw TCP
- Ensure peering connection has sufficient bandwidth
- Check for NAT gateway bottlenecks
- Consider dedicated PrivateLink connection for high-throughput

## Cost Comparison

| Component | CloudFront | NLB + ALB |
|-----------|-----------|----------|
| Monthly Base | $0.085/GB egress | $0.006/LCU (ALB) |
|  | (assume 1TB/mo) | $0.006/LCU (NLB) |
| Estimated Cost | $85 + data | ~$15-30/month |
| Regional | Yes (CDN) | No (single region) |
| Cross-Account | Via internet | Direct VPC |

## Security Best Practices

1. **Minimum CIDR Ranges**: Specify exact VPC CIDRs instead of 10.0.0.0/8
2. **Security Group Logging**: Enable VPC Flow Logs to monitor traffic
3. **TLS/SSL**: Implement at application layer if required
4. **Cross-Account Policy**: Use resource-based policies on ALB for access control
5. **Network ACLs**: Additional layer of protection in private subnets

## References

- [AWS VPC Peering](https://docs.aws.amazon.com/vpc/latest/peering/)
- [AWS PrivateLink](https://docs.aws.amazon.com/vpc/latest/privatelink/)
- [ALB Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/)
- [NLB Documentation](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/)

---

## VPC Import Notes (Updated)

- Private-only architecture: resources run in private subnets with no public IPs.
- Import an existing VPC by editing `cdk/lib/vpc-stack.ts`:
  - Set `existingVpcId` to your VPC ID.
  - Provide `backendSubnetId` and optionally `backendSubnetId2`, `backendSubnetId3` for 1–3 AZs.
  - Provide matching `backendRouteTableId*` values to avoid warnings and enable constructs requiring route tables at synth time.
  - Set `this.vpcCidrString` to your actual VPC CIDR; this is required when creating interface VPC endpoints.

Find a route table ID for a subnet (PowerShell):
```pwsh
aws ec2 describe-route-tables --filters "Name=association.subnet-id,Values=subnet-xxxxxxxx" --query "RouteTables[0].RouteTableId" --output text --profile empath-prod
```

### Troubleshooting
- Early validation failures during VPC import:
  - Ensure subnets and AZs align (the stack adapts to 1–3 subnets).
  - Provide `this.vpcCidrString` when using specific subnets so interface VPC endpoints can be created.
  - Avoid `Fn.importValue` Control Tower exports when supplying explicit subnet and route table IDs.
- Warning: `No routeTableId was provided to the subnet ...` → Provide `backendRouteTableId*` in `vpc-stack.ts`.
