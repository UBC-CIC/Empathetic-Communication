import React, { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, VolumeUp, VolumeOff, Close, Phone, PhoneDisabled } from '@mui/icons-material';
import { IconButton, Paper, Typography, Box, Dialog, CircularProgress, Chip } from '@mui/material';

const VoiceConversation = ({ open, onClose, patientContext = "" }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [conversationLog, setConversationLog] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
  const websocketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    if (open) {
      connectToVoiceService();
    } else {
      disconnectFromVoiceService();
    }

    return () => {
      disconnectFromVoiceService();
    };
  }, [open]);

  const connectToVoiceService = () => {
    // Use Socket.IO
    const socketUrl = import.meta.env.VITE_VOICE_SOCKETIO_URL || 'http://localhost:3001';
    console.log('Connecting to Socket.IO voice service:', socketUrl);
    
    // Import socket.io-client dynamically
    import('socket.io-client').then(({ io }) => {
      websocketRef.current = io(socketUrl, {
        transports: ['websocket', 'polling']
      });
      
      websocketRef.current.on('connect', () => {
        console.log('Socket.IO connected');
        setIsConnected(true);
        setConnectionStatus('connected');
      });
      
      websocketRef.current.on('student_transcription', (data) => {
        console.log('Student transcription:', data.text);
        handleVoiceMessage({ type: 'student_transcription', text: data.text });
      });
      
      websocketRef.current.on('patient_response', (data) => {
        console.log('Patient response:', data.text);
        handleVoiceMessage({ type: 'patient_response', text: data.text, audio: data.audio });
      });
      
      websocketRef.current.on('error', (data) => {
        console.error('Socket.IO error:', data.message);
        handleVoiceMessage({ type: 'error', message: data.message });
      });
      
      websocketRef.current.on('disconnect', () => {
        console.log('🔌 Socket.IO disconnected');
        setIsConnected(false);
        setConnectionStatus('disconnected');
      });
      
      websocketRef.current.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        setConnectionStatus('error');
      });
    });
  };

  const disconnectFromVoiceService = () => {
    if (websocketRef.current) {
      websocketRef.current.disconnect();
    }
    
    if (mediaRecorderRef.current && isRecording) {
      stopRecording();
    }
    
    setIsConnected(false);
    setIsRecording(false);
    setIsSpeaking(false);
    setConversationLog([]);
    setConnectionStatus('disconnected');
  };

  const handleVoiceMessage = (data) => {
    switch (data.type) {
      case 'conversation_started':
        console.log('🎙️ Voice conversation started');
        setConversationLog(prev => [...prev, {
          type: 'system',
          message: 'Voice conversation started. You can now speak to the patient.',
          timestamp: new Date()
        }]);
        break;
        
      case 'student_transcription':
        console.log('👨‍🎓 Student said:', data.text);
        setConversationLog(prev => [...prev, {
          type: 'student',
          message: data.text,
          timestamp: new Date()
        }]);
        break;
        
      case 'patient_response':
        console.log('Patient responded:', data.text);
        setConversationLog(prev => [...prev, {
          type: 'patient',
          message: data.text,
          timestamp: new Date()
        }]);
        
        // Play patient's voice response if available
        if (data.audio && data.audio.length > 0) {
          console.log('Playing patient voice response');
          playAudioResponse(data.audio);
        } else {
          console.log('No audio data received for patient response');
        }
        break;
        
      case 'error':
        console.error('Voice conversation error:', data.message);
        setConversationLog(prev => [...prev, {
          type: 'error',
          message: data.message,
          timestamp: new Date()
        }]);
        break;
        
      case 'conversation_ended':
        console.log('🔚 Voice conversation ended');
        setConversationLog(prev => [...prev, {
          type: 'system',
          message: 'Voice conversation ended.',
          timestamp: new Date()
        }]);
        break;
    }
  };

  const startRecording = async () => {
    if (!isConnected) {
      console.error('Not connected to voice service');
      return;
    }

    try {
      console.log('Starting voice recording...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        sendVoiceInput(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      // Record in smaller chunks to keep file size down
      mediaRecorderRef.current.start(1000); // 1 second chunks
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendVoiceInput = async (audioBlob) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64Audio = reader.result.split(',')[1];
      console.log('Voice input size:', base64Audio.length);
      
      // Check if audio is too large for WebSocket (32KB limit)
      if (base64Audio.length > 25000) {
        console.log('Audio too large, compressing...');
        compressAndSendAudio(audioBlob);
      } else {
        sendAudioData(base64Audio);
      }
    };
    reader.readAsDataURL(audioBlob);
  };

  const sendAudioData = (base64Audio) => {
    if (websocketRef.current && websocketRef.current.connected) {
      console.log('Sending voice input via Socket.IO');
      
      const message = {
        audio_data: base64Audio,
        patient_context: patientContext
      };
      
      console.log('Message being sent:', { ...message, audio_data: `[${base64Audio.length} chars]` });
      websocketRef.current.emit('voice_input', message);
    } else {
      console.error('Socket.IO not connected');
    }
  };

  const compressAndSendAudio = async (audioBlob) => {
    try {
      // Simple compression: take only first half of audio
      const arrayBuffer = await audioBlob.arrayBuffer();
      const halfSize = Math.floor(arrayBuffer.byteLength / 2);
      const compressedBuffer = arrayBuffer.slice(0, halfSize);
      const compressedBlob = new Blob([compressedBuffer], { type: 'audio/wav' });
      
      const reader = new FileReader();
      reader.onload = () => {
        const base64Audio = reader.result.split(',')[1];
        console.log('Compressed audio size:', base64Audio.length);
        
        if (base64Audio.length < 30000) {
          sendAudioData(base64Audio);
        } else {
          // Try even more aggressive compression
          const quarterSize = Math.floor(arrayBuffer.byteLength / 4);
          const veryCompressedBuffer = arrayBuffer.slice(0, quarterSize);
          const veryCompressedBlob = new Blob([veryCompressedBuffer], { type: 'audio/wav' });
          
          const finalReader = new FileReader();
          finalReader.onload = () => {
            const finalBase64 = finalReader.result.split(',')[1];
            console.log('Final compressed size:', finalBase64.length);
            
            if (finalBase64.length < 30000) {
              sendAudioData(finalBase64);
            } else {
              console.error('Audio still too large after aggressive compression');
              setConversationLog(prev => [...prev, {
                type: 'error',
                message: 'Audio recording too long. Please try a much shorter message (1-2 seconds).',
                timestamp: new Date()
              }]);
            }
          };
          finalReader.readAsDataURL(veryCompressedBlob);
        }
      };
      reader.readAsDataURL(compressedBlob);
      
    } catch (error) {
      console.error('Audio compression failed:', error);
      setConversationLog(prev => [...prev, {
        type: 'error',
        message: 'Failed to process audio. Please try again.',
        timestamp: new Date()
      }]);
    }
  };

  const playAudioResponse = (base64Audio) => {
    try {
      setIsSpeaking(true);
      const audioData = atob(base64Audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);
      
      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }
      
      const audioBlob = new Blob([arrayBuffer], { type: 'audio/mp3' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        console.error('Error playing audio response');
      };
      
      audio.play();
    } catch (error) {
      console.error('Error playing audio:', error);
      setIsSpeaking(false);
    }
  };

  const handleClose = () => {
    disconnectFromVoiceService();
    onClose();
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'success';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'reconnecting': return 'Reconnecting...';
      case 'error': return 'Connection Error';
      default: return 'Disconnected';
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <Paper sx={{ p: 3, minHeight: 500 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">Voice Conversation with Patient</Typography>
          <Box display="flex" alignItems="center" gap={2}>
            <Chip 
              label={getStatusText()} 
              color={getStatusColor()} 
              size="small"
            />
            <IconButton onClick={handleClose}>
              <Close />
            </IconButton>
          </Box>
        </Box>
        
        {/* Connection Status */}
        {!isConnected && (
          <Box display="flex" justifyContent="center" alignItems="center" py={4}>
            <CircularProgress />
            <Typography variant="body2" sx={{ ml: 2 }}>
              Connecting to voice service...
            </Typography>
          </Box>
        )}
        
        {/* Voice Controls */}
        {isConnected && (
          <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
            {/* Recording Button */}
            <Box position="relative">
              <IconButton
                onClick={isRecording ? stopRecording : startRecording}
                color={isRecording ? "secondary" : "primary"}
                size="large"
                sx={{ 
                  width: 100, 
                  height: 100,
                  border: isRecording ? '4px solid #f44336' : '4px solid #1976d2',
                  animation: isRecording ? 'pulse 1.5s infinite' : 'none',
                  '@keyframes pulse': {
                    '0%': {
                      boxShadow: '0 0 0 0 rgba(244, 67, 54, 0.7)',
                    },
                    '70%': {
                      boxShadow: '0 0 0 15px rgba(244, 67, 54, 0)',
                    },
                    '100%': {
                      boxShadow: '0 0 0 0 rgba(244, 67, 54, 0)',
                    },
                  }
                }}
              >
                {isRecording ? <MicOff fontSize="large" /> : <Mic fontSize="large" />}
              </IconButton>
              
              {isSpeaking && (
                <Box
                  position="absolute"
                  top={-10}
                  right={-10}
                  sx={{
                    backgroundColor: 'success.main',
                    borderRadius: '50%',
                    p: 1,
                    animation: 'speaking 1s infinite alternate'
                  }}
                >
                  <VolumeUp sx={{ color: 'white', fontSize: 20 }} />
                </Box>
              )}
            </Box>

            {/* Status Text */}
            <Typography variant="body1" color="textSecondary" textAlign="center">
              {isRecording ? 'Recording... Release to send' : 
               isSpeaking ? 'Patient is speaking...' : 
               'Hold to speak to the patient'}
            </Typography>

            {/* Conversation Log */}
            <Paper 
              variant="outlined" 
              sx={{ 
                width: '100%', 
                maxHeight: 300, 
                overflow: 'auto', 
                p: 2,
                backgroundColor: '#f5f5f5'
              }}
            >
              <Typography variant="subtitle2" gutterBottom>
                Conversation Log:
              </Typography>
              
              {conversationLog.length === 0 ? (
                <Typography variant="body2" color="textSecondary" style={{ fontStyle: 'italic' }}>
                  Start speaking to begin the conversation...
                </Typography>
              ) : (
                conversationLog.map((entry, index) => (
                  <Box key={index} mb={1}>
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        fontWeight: entry.type === 'student' ? 'bold' : 'normal',
                        color: entry.type === 'patient' ? 'primary.main' : 
                               entry.type === 'error' ? 'error.main' : 
                               entry.type === 'system' ? 'text.secondary' : 'text.primary'
                      }}
                    >
                      <strong>
                        {entry.type === 'student' ? 'You: ' : 
                         entry.type === 'patient' ? 'Patient: ' : 
                         entry.type === 'system' ? 'System: ' : 'Error: '}
                      </strong>
                      {entry.message}
                    </Typography>
                  </Box>
                ))
              )}
            </Paper>

            {/* End Conversation Button */}
            <IconButton
              onClick={handleClose}
              color="error"
              size="large"
              sx={{ 
                border: '2px solid',
                borderColor: 'error.main'
              }}
            >
              <PhoneDisabled fontSize="large" />
            </IconButton>
          </Box>
        )}
      </Paper>
    </Dialog>
  );
};

export default VoiceConversation;