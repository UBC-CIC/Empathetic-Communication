# WebSocket Integration with Amplify

This guide explains how to set up secure WebSocket connections with your Amplify frontend application.

## Prerequisites

1. A domain name registered in Route 53 or another domain registrar
2. An AWS Certificate Manager (ACM) certificate for your domain
3. AWS Amplify application set up for your frontend

## Step 1: Create an SSL Certificate

1. Go to AWS Certificate Manager (ACM) in the AWS Console
2. Click "Request a certificate"
3. Choose "Request a public certificate"
4. Enter your domain name (e.g., `socket.yourdomain.com`)
5. Choose DNS validation
6. Create the certificate
7. Follow the validation steps to validate your domain ownership

## Step 2: Update the ECS Socket Stack

When deploying your CDK stack, provide the certificate ARN and domain information:

```typescript
// In your CDK deployment script
const socketStack = new EcsSocketStack(this, 'EcsSocketStack', vpcStack, {
  certificateArn: 'arn:aws:acm:region:account-id:certificate/certificate-id',
  domainName: 'socket.yourdomain.com',
  hostedZoneId: 'your-hosted-zone-id',
  createDnsRecord: true
});
```

## Step 3: Configure Amplify Environment Variables

1. Go to your Amplify app in the AWS Console
2. Navigate to "Environment variables"
3. Add a new environment variable:
   - Name: `SOCKET_URL`
   - Value: `wss://socket.yourdomain.com` (use your actual domain)
4. Save the changes

## Step 4: Update Your Frontend Code

Use the `socketConnection.js` utility to establish WebSocket connections in your React components:

```jsx
import { useEffect } from 'react';
import { initializeSocket, closeSocket } from '../functions/socketConnection';

function YourComponent() {
  useEffect(() => {
    // Initialize socket connection
    const socket = initializeSocket();
    
    // Set up event listeners
    socket.on('message', (data) => {
      console.log('Received message:', data);
      // Handle the message
    });
    
    // Clean up on component unmount
    return () => {
      closeSocket();
    };
  }, []);
  
  // Rest of your component
}
```

## Troubleshooting

### CORS Issues

If you encounter CORS issues, make sure your WebSocket server has the appropriate CORS configuration:

```javascript
// In your socket-server code
const io = require('socket.io')(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "https://yourdomain.com",
    methods: ["GET", "POST"],
    credentials: true
  }
});
```

### Connection Issues

If you're having trouble connecting:

1. Check that your domain is correctly pointing to the load balancer
2. Verify that the security groups allow WebSocket traffic (ports 80/443)
3. Ensure your certificate is valid and correctly attached to the load balancer
4. Check browser console for any connection errors

### Testing WebSocket Connection

You can test your WebSocket connection using online tools like [WebSocket King](https://websocketking.com/) or with this simple HTML file:

```html
<!DOCTYPE html>
<html>
<head>
  <title>WebSocket Test</title>
  <script src="https://cdn.socket.io/4.4.1/socket.io.min.js"></script>
</head>
<body>
  <h1>WebSocket Test</h1>
  <div id="status">Connecting...</div>
  <script>
    const socket = io('wss://socket.yourdomain.com');
    
    socket.on('connect', () => {
      document.getElementById('status').textContent = 'Connected!';
    });
    
    socket.on('disconnect', () => {
      document.getElementById('status').textContent = 'Disconnected';
    });
    
    socket.on('error', (error) => {
      document.getElementById('status').textContent = 'Error: ' + error;
    });
  </script>
</body>
</html>
```