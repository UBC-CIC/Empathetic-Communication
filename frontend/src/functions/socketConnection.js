import { io } from 'socket.io-client';

// Get the WebSocket URL from environment variables
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || window.SOCKET_URL;

// Create a socket instance
let socket;

export const initializeSocket = (voiceId = 'lennart') => {
  if (!socket) {
    console.log(`Connecting to socket server at: ${SOCKET_URL}`);
    
    // Create WebSocket connection
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      secure: SOCKET_URL.startsWith('https') || SOCKET_URL.startsWith('wss'),
    });

    // Connection event handlers
    socket.on('connect', () => {
      console.log('Socket connected successfully');
      
      // Start Nova Sonic session with the specified voice
      socket.emit('start-nova-sonic', { voice_id: voiceId });
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
    
    // Set up event listeners for Nova responses
    socket.on('nova-started', (data) => {
      console.log('Nova session started:', data);
    });
    
    socket.on('text-message', (data) => {
      console.log('Received text message:', data);
    });
    
    socket.on('audio-chunk', (data) => {
      console.log('Received audio chunk, size:', data.data ? data.data.length : 0);
    });
  }
  
  return socket;
};

export const getSocket = () => {
  if (!socket) {
    return initializeSocket();
  }
  return socket;
};

export const closeSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const sendAudioInput = (audioData) => {
  const socket = getSocket();
  if (socket && socket.connected) {
    socket.emit('audio-input', { data: audioData });
  } else {
    console.error('Cannot send audio - socket not connected');
  }
};

export const endAudioInput = () => {
  const socket = getSocket();
  if (socket && socket.connected) {
    socket.emit('end-audio');
  }
};

export const startAudioInput = () => {
  const socket = getSocket();
  if (socket && socket.connected) {
    socket.emit('start-audio');
  }
};