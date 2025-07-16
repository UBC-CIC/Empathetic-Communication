import os
import asyncio
import base64
import json
import uuid
import random
import boto3
from socket_client import SocketClient

# Audio config
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
CHANNELS = 1
CHUNK_SIZE = 1024


class NovaSonic:
    def __init__(self, model_id='amazon.nova-sonic-v1:0', region='us-east-1', socket_url=None):
        self.model_id = model_id
        self.region = region
        self.client = None
        self.stream = None
        self.response = None
        self.is_active = False
        self.prompt_name = str(uuid.uuid4())
        self.content_name = str(uuid.uuid4())
        self.audio_content_name = str(uuid.uuid4())
        self.audio_queue = asyncio.Queue()
        self.role = None
        self.display_assistant_text = False
        self.socket_client = SocketClient(socket_url) if socket_url else None

    def _init_client(self):
        """Initialize the Bedrock Client for Nova"""
        self.client = boto3.client('bedrock-runtime', region_name=self.region)

    async def send_event(self, event_json):
        """Send an event to the stream"""
        event = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=event_json.encode('utf-8'))
        )
        await self.stream.input_stream.send(event)

    async def start_session(self):
        """Start a new Nova Sonic session"""
        if not self.client:
            self._init_client()
        
        if self.socket_client:
            await self.socket_client.connect()

        # Init stream

                # Initialize the stream
        self.stream = await self.client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
        )
        
        self.is_active = True

        # Send session start event
        session_start = '''
        {
            "event": {
                "sessionStart": {
                "inferenceConfiguration": {
                    "maxTokens": 1024,
                    "topP": 0.9,
                    "temperature": 0.7
                    }
                }
            }
        }
        '''

        await self.send_event(session_start)
        
        # Send prompt start event
        voice_ids = {"feminine": ["amy", "tiffany", "lupe"], "masculine": ["matthew", "carlos"]}

        prompt_start = f'''
        {{
          "event": {{
            "promptStart": {{
              "promptName": "{self.prompt_name}",
              "textOutputConfiguration": {{
                "mediaType": "text/plain"
              }},
              "audioOutputConfiguration": {{
                "mediaType": "audio/lpcm",
                "sampleRateHertz": 24000,
                "sampleSizeBits": 16,
                "channelCount": 1,
                "voiceId": "{random.choice(voice_ids["feminine"])}",
                "encoding": "base64",
                "audioType": "SPEECH"
              }}
            }}
          }}
        }}
        ''' # voiceId can also be configured to 'matthew' later on for male patients

        await self.send_event(prompt_start)

        # Send system prompt
        text_content_start = f'''
        {{
            "event": {{
                "contentStart": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{self.content_name}",
                    "type": "TEXT",
                    "interactive": true,
                    "role": "SYSTEM",
                    "textInputConfiguration": {{
                        "mediaType": "text/plain"
                    }}
                }}
            }}
        }}
        '''

        await self.send_event(text_content_start)

        system_prompt = "You are to act as a concerned patient with a diagnosis (choose a random disease, pretend like you're not aware what it is until I say 'simulation over' and ask about it). I will ask you questions to help diagnose your condition. Please answer as accurately as possible. Sound distressed if you are in pain or uncomfortable. If you are not in distress, please respond calmly and clearly."
        
        text_input = f'''
        {{
            "event": {{
                "textInput": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{self.content_name}",
                    "content": "{system_prompt}"
                }}
            }}
        }}
        '''
        await self.send_event(text_input)

        text_content_end = f'''
        {{
            "event": {{
                "contentEnd": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{self.content_name}"
                }}
            }}
        }}
        '''
        await self.send_event(text_content_end)

        # Start audio input immediately
        await self.start_audio_input()
        
        # Send initial greeting to trigger response
        await self.send_text_message("Hello, I'm here to help. How are you feeling today?")
        
        # Start processing responses
        self.response = asyncio.create_task(self._process_responses())

    async def start_audio_input(self):
        """Start audio input stream."""
        audio_content_start = f'''
        {{
            "event": {{
                "contentStart": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{self.audio_content_name}",
                    "type": "AUDIO",
                    "interactive": true,
                    "role": "USER",
                    "audioInputConfiguration": {{
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 16000,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "audioType": "SPEECH",
                        "encoding": "base64"
                    }}
                }}
            }}
        }}
        '''
        await self.send_event(audio_content_start)
    
    async def send_audio_chunk(self, audio_bytes):
        """Send an audio chunk to the stream."""
        if not self.is_active:
            return
            
        blob = base64.b64encode(audio_bytes)
        audio_event = f'''
        {{
            "event": {{
                "audioInput": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{self.audio_content_name}",
                    "content": "{blob.decode('utf-8')}"
                }}
            }}
        }}
        '''
        await self.send_event(audio_event)
    
    async def end_audio_input(self):
        """End audio input stream."""
        audio_content_end = f'''
        {{
            "event": {{
                "contentEnd": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{self.audio_content_name}"
                }}
            }}
        }}
        '''
        await self.send_event(audio_content_end)
    
    async def end_session(self):
        """End the session."""
        if not self.is_active:
            return
            
        prompt_end = f'''
        {{
            "event": {{
                "promptEnd": {{
                    "promptName": "{self.prompt_name}"
                }}
            }}
        }}
        '''
        await self.send_event(prompt_end)
        
        session_end = '''
        {
            "event": {
                "sessionEnd": {}
            }
        }
        '''
        await self.send_event(session_end)
        # close the stream
        await self.stream.input_stream.close()

    async def _process_responses(self):
        """Process responses from the stream."""
        try:
            while self.is_active:
                output = await self.stream.await_output()
                result = await output[1].receive()
                
                if result.value and result.value.bytes_:
                    response_data = result.value.bytes_.decode('utf-8')
                    json_data = json.loads(response_data)
                    
                    if 'event' in json_data:
                        # Handle content start event
                        if 'contentStart' in json_data['event']:
                            content_start = json_data['event']['contentStart'] 
                            # set role
                            self.role = content_start['role']
                            # Check for speculative content
                            if 'additionalModelFields' in content_start:
                                additional_fields = json.loads(content_start['additionalModelFields'])
                                if additional_fields.get('generationStage') == 'SPECULATIVE':
                                    self.display_assistant_text = True
                                else:
                                    self.display_assistant_text = False
                                
                        # Handle text output event
                        elif 'textOutput' in json_data['event']:
                            text = json_data['event']['textOutput']['content']    
                           
                            if (self.role == "ASSISTANT" and self.display_assistant_text):
                                print(f"Assistant: {text}")
                                if self.socket_client:
                                    await self.socket_client.emit_text_message(f"Assistant: {text}")
                            elif self.role == "USER":
                                print(f"User: {text}")
                                if self.socket_client:
                                    await self.socket_client.emit_text_message(f"User: {text}")
                        
                        # Handle audio output
                        elif 'audioOutput' in json_data['event']:
                            audio_content = json_data['event']['audioOutput']['content']
                            # Send base64 audio directly to frontend
                            await self.audio_queue.put(audio_content)
                            if self.socket_client:
                                await self.socket_client.emit_audio_chunk(base64.b64decode(audio_content))
                            # Also output for Node.js to capture
                            print(json.dumps({"type": "audio", "data": audio_content}), flush=True)
        except Exception as e:
            print(f"Error processing responses: {e}")
    
    async def stream_audio_to_frontend(self):
        """Stream audio responses to frontend via stdout."""
        try:
            while self.is_active:
                audio_data = await self.audio_queue.get()
                # audio_data is already base64 from Nova Sonic
                print(json.dumps({"type": "audio", "data": audio_data}), flush=True)
        except Exception as e:
            print(json.dumps({"type": "error", "text": str(e)}), flush=True)
    
    async def send_text_message(self, text):
        """Send text message to Nova Sonic."""
        # Start new text content
        text_content_name = str(uuid.uuid4())
        
        text_content_start = f'''
        {{
            "event": {{
                "contentStart": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{text_content_name}",
                    "type": "TEXT",
                    "interactive": true,
                    "role": "USER",
                    "textInputConfiguration": {{
                        "mediaType": "text/plain"
                    }}
                }}
            }}
        }}
        '''
        await self.send_event(text_content_start)
        
        text_input = f'''
        {{
            "event": {{
                "textInput": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{text_content_name}",
                    "content": "{text}"
                }}
            }}
        }}
        '''
        await self.send_event(text_input)
        
        text_content_end = f'''
        {{
            "event": {{
                "contentEnd": {{
                    "promptName": "{self.prompt_name}",
                    "contentName": "{text_content_name}"
                }}
            }}
        }}
        '''
        await self.send_event(text_content_end)

    async def receive_audio_from_frontend(self, audio_data):
        """Receive audio data from frontend and send to Nova Sonic."""
        if self.is_active:
            await self.send_audio_chunk(audio_data)

async def main():
    nova_client = NovaSonic()
    await nova_client.start_session()
    
    print(json.dumps({"type": "text", "text": "Nova Sonic ready! Ask me anything."}))
    
    # Process stdin for text/audio input
    async def handle_input():
        import sys
        while nova_client.is_active:
            try:
                line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
                if not line:
                    break
                    
                data = json.loads(line.strip())
                if data['type'] == 'text':
                    await nova_client.send_text_message(data['data'])
                elif data['type'] == 'audio':
                    audio_bytes = base64.b64decode(data['data'])
                    await nova_client.send_audio_chunk(audio_bytes)
                elif data['type'] == 'end_audio':
                    await nova_client.end_audio_input()
                    await nova_client.start_audio_input()  # Restart for next input
            except Exception as e:
                print(json.dumps({"type": "error", "text": str(e)}))
    
    # Start input handler and audio streaming
    input_task = asyncio.create_task(handle_input())
    stream_task = asyncio.create_task(nova_client.stream_audio_to_frontend())
    
    await asyncio.gather(input_task, stream_task, return_exceptions=True)
    
    nova_client.is_active = False
    await nova_client.end_session()
    
if __name__ == "__main__":
    asyncio.run(main())