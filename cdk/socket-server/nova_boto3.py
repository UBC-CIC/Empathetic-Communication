import os
import sys
import asyncio
import base64
import json
import uuid
import random
import boto3
from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart
from aws_sdk_bedrock_runtime.config import Config, HTTPAuthSchemeResolver, SigV4AuthScheme
from smithy_aws_core.credentials_resolvers.environment import EnvironmentCredentialsResolver

# Audio config
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
CHANNELS = 1
CHUNK_SIZE = 1024

session = boto3.Session()
creds = session.get_credentials()
frozen_creds = creds.get_frozen_credentials()

os.environ['AWS_ACCESS_KEY_ID'] = creds.access_key
os.environ['AWS_SECRET_ACCESS_KEY'] = creds.secret_key
os.environ['AWS_DEFAULT_REGION'] = 'us-east-1'
if creds.token:
    os.environ['AWS_SESSION_TOKEN'] = creds.token


class NovaSonic:

    def refresh_env_credentials(self):
        global creds, frozen_creds
        # Refresh AWS credentials from the environment
        session = boto3.Session()
        creds = session.get_credentials()
        frozen_creds = creds.get_frozen_credentials()
        
        os.environ['AWS_ACCESS_KEY_ID'] = creds.access_key
        os.environ['AWS_SECRET_ACCESS_KEY'] = creds.secret_key
        if creds.token:
            os.environ['AWS_SESSION_TOKEN'] = creds.token

    def __init__(self, model_id='amazon.nova-sonic-v1:0', region='us-east-1', socket_client=None, voice_id=None):
        self.refresh_env_credentials()
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
        self.display_assistant_text = False  # maybe change later?
        self.voice_id = voice_id  # Store the voice ID passed from frontend

    def _init_client(self):
        """Initialize the Bedrock Client for Nova"""
        self.refresh_env_credentials()
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
            region=self.region,
            aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
            http_auth_scheme_resolver=HTTPAuthSchemeResolver(),
            http_auth_schemes={"aws.auth#sigv4": SigV4AuthScheme()},
        )
        self.client = BedrockRuntimeClient(config=config)
        print(f"Initialized Bedrock client for model {self.model_id} in region {self.region}")

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

        # Init stream
        self.stream = await self.client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
        )
        print("✅ Bidirectional stream initialized with Nova Sonic", flush=True)

        
        self.is_active = True

        # Send session start event
        session_start = '''
        {
            "event": {
                "sessionStart": {
                "inferenceConfiguration": {
                    "maxTokens": 2048,
                    "topP": 1.0,
                    "temperature": 0.8,
                    "stopSequences": []
                    }
                }
            }
        }
        '''

        await self.send_event(session_start)
        
        # Send prompt start event
        voice_ids = {"feminine": ["amy", "tiffany", "lupe"], "masculine": ["matthew", "carlos"]}
        
        # Use the voice ID from frontend if provided, otherwise select a random feminine voice
        selected_voice = self.voice_id if self.voice_id else random.choice(voice_ids['feminine'])
        
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
                "voiceId": "{selected_voice}",
                "encoding": "base64",
                "audioType": "SPEECH"
              }}
            }}
          }}
        }}
        ''' # Using the selected voice ID

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

        system_prompt = "You are to act as a concerned patient with a diagnosis of migraine headaches. I will ask you questions to help diagnose your condition. Please answer as accurately as possible. Sound distressed if you are in pain or uncomfortable. If you are not in distress, please respond calmly and clearly. IMPORTANT: Always respond with both text and audio. Do not remain silent. Speak directly to me as if we are having a conversation."
        
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

        # Start processing responses
        self.response = asyncio.create_task(self._process_responses())

        print(f"✅ Nova Sonic session started (Prompt ID: {self.prompt_name})", flush=True)
        # at the end of start_session() in nova_sonic.py
        print(json.dumps({ "type": "text", "text": "Nova Sonic ready" }), flush=True)



    async def start_audio_input(self):
        """Start audio input stream."""

        self.audio_content_name = str(uuid.uuid4())  # NEW valid name
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
                    response_data = result.value.bytes_.decode("utf-8")
                    print("🟡 RAW RESPONSE:", response_data, flush=True)

                    try:
                        json_data = json.loads(response_data)
                        print("🟢 PARSED JSON:", json.dumps(json_data, indent=2), flush=True)

                        if 'event' in json_data:
                            if 'contentStart' in json_data['event']:
                                content_start = json_data['event']['contentStart']
                                self.role = content_start['role']
                                if 'additionalModelFields' in content_start:
                                    additional_fields = json.loads(content_start['additionalModelFields'])
                                    self.display_assistant_text = (
                                        additional_fields.get("generationStage") == "SPECULATIVE"
                                    )

                            elif 'textOutput' in json_data['event']:
                                text = json_data['event']['textOutput']['content']
                                if self.role == "ASSISTANT":
                                    print(f"Assistant: {text}", flush=True)
                                    print(json.dumps({ "type": "text", "text": text }), flush=True)
                                elif self.role == "USER":
                                    print(f"User: {text}", flush=True)

                            elif 'audioOutput' in json_data['event']:
                                audio_content = json_data['event']['audioOutput']['content']
                                audio_bytes = base64.b64decode(audio_content)
                                await self.audio_queue.put(audio_bytes)
                                print("🔊 AUDIO OUTPUT RECEIVED, size:", len(audio_bytes), flush=True)
                                print(json.dumps({
                                    "type": "audio",
                                    "data": base64.b64encode(audio_bytes).decode("utf-8"),
                                    "size": len(audio_bytes)
                                }), flush=True)

                    except Exception as e:
                        print(f"❌ Failed to parse response: {e}", flush=True)
                        print(f"❌ Raw data was: {response_data}", flush=True)
        except Exception as e:
            print(f"🔥 Error in _process_responses(): {e}", flush=True)

async def handle_stdin(nova_client):
    reader = asyncio.StreamReader()
    loop = asyncio.get_event_loop()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        line = await reader.readline()
        if not line:
            break

        try:
            msg = json.loads(line.decode("utf-8"))
            if msg["type"] == "audio":
                print("🎤 Received audio input from stdin", flush=True)
                audio_bytes = base64.b64decode(msg["data"])
                await nova_client.send_audio_chunk(audio_bytes)
            elif msg["type"] == "start_audio":
                print("🎬 Received start_audio signal", flush=True)
                await nova_client.start_audio_input()
                print("🎤 Started audio input", flush=True)
            elif msg["type"] == "end_audio":
                print("🎬 Received end_audio signal", flush=True)
                await nova_client.end_audio_input()
            elif msg["type"] == "set_voice":
                voice_id = msg.get("voice_id")
                print(f"🎭 Received voice change request: {voice_id}", flush=True)
                nova_client.voice_id = voice_id
                print(f"🎭 Voice set to: {nova_client.voice_id}", flush=True)
                # Force a restart of the session with the new voice
                if nova_client.is_active:
                    print("Restarting session with new voice", flush=True)
                    await nova_client.end_session()
                    await nova_client.start_session()
        except Exception as e:
            print(f"❌ Failed to process stdin input: {e}", flush=True)

async def main():
    # Initialize with no voice_id, will be set by frontend
    nova_client = NovaSonic()
    
    # First listen for any initial configuration from stdin
    # This allows the frontend to set the voice before starting the session
    reader = asyncio.StreamReader()
    loop = asyncio.get_event_loop()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    
    # Wait for initial configuration for a short time
    try:
        # Set a timeout for initial configuration
        line = await asyncio.wait_for(reader.readline(), 2.0)
        if line:
            try:
                msg = json.loads(line.decode("utf-8"))
                if msg["type"] == "set_voice":
                    print(f"🎭 Setting initial voice: {msg.get('voice_id')}", flush=True)
                    nova_client.voice_id = msg.get("voice_id")
            except Exception as e:
                print(f"❌ Failed to process initial config: {e}", flush=True)
    except asyncio.TimeoutError:
        print("No initial configuration received, using default voice", flush=True)
    
    # Start the session with the configured voice
    await nova_client.start_session()
    print("Nova session started. Listening for stdin input...")
    
    stdin_task = asyncio.create_task(handle_stdin(nova_client))
    await stdin_task

    await nova_client.end_session()
    print("Session ended")

    
if __name__ == "__main__":
    asyncio.run(main())