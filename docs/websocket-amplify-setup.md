# WebSocket Integration with Amplify

This guide explains how to integrate the secure WebSocket server with your Amplify frontend.

## Step 1: Deploy the ECS Socket Stack with HTTPS

When deploying your CDK stack, provide the certificate ARN:

```typescript
const socketStack = new EcsSocketStack(this, 'EcsSocketStack', vpcStack, {
  certificateArn: 'arn:aws:acm:region:account-id:certificate/certificate-id',
  domainName: 'socket.yourdomain.com',
  hostedZoneId: 'your-hosted-zone-id',
  createDnsRecord: true
});
```

## Step 2: Configure Amplify Environment Variables

1. Go to your Amplify app in the AWS Console
2. Navigate to "Environment variables"
3. Add these environment variables:
   - `REACT_APP_SOCKET_URL`: Set to `https://socket.yourdomain.com` (your actual domain)
   - `REACT_APP_ALLOWED_ORIGINS`: Set to your Amplify app URL (e.g., `https://main.d123456abcdef.amplifyapp.com`)

## Step 3: Update Your Frontend Code

Use the `socketConnection.js` utility in your components:

```jsx
import { useEffect } from 'react';
import { initializeSocket, closeSocket, sendAudioInput } from '../functions/socketConnection';

function YourComponent() {
  useEffect(() => {
    // Initialize socket with a specific voice
    const socket = initializeSocket('lennart');
    
    // Set up event listeners
    socket.on('text-message', (data) => {
      console.log('Received message:', data.text);
      // Handle the message
    });
    
    socket.on('audio-chunk', (data) => {
      // Handle audio data
      const audioData = data.data;
      // Process audio...
    });
    
    // Clean up on component unmount
    return () => {
      closeSocket();
    };
  }, []);
  
  // Function to send audio data
  const handleSendAudio = (audioData) => {
    sendAudioInput(audioData);
  };
  
  // Rest of your component
}
```

## Step 4: Update Amplify Build Settings

Create or update your `amplify.yml` file:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - cd frontend
        - npm ci
    build:
      commands:
        - echo "REACT_APP_SOCKET_URL=${SOCKET_URL}" >> .env
        - echo "REACT_APP_ALLOWED_ORIGINS=${ALLOWED_ORIGINS}" >> .env
        - npm run build
  artifacts:
    baseDirectory: frontend/build
    files:
      - '**/*'
  cache:
    paths:
      - 'frontend/node_modules/**/*'
```

## Troubleshooting

### Connection Issues

If you're having trouble connecting:

1. Check browser console for errors
2. Verify that your domain is correctly pointing to the load balancer
3. Ensure your certificate is valid and correctly attached to the load balancer
4. Check that CORS settings are properly configured

### Testing the Connection

You can test your WebSocket connection using this code in your browser console:

```javascript
const socket = io('https://socket.yourdomain.com', {
  transports: ['websocket'],
  secure: true
});

socket.on('connect', () => {
  console.log('Connected!');
  socket.emit('start-nova-sonic', { voice_id: 'lennart' });
});

socket.on('text-message', (data) => {
  console.log('Text message:', data.text);
});

socket.on('audio-chunk', (data) => {
  console.log('Audio received:', data.data.length);
});
```