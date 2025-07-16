import asyncio
import json
import sys
import base64
import uuid
import random
import os
from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart
from aws_sdk_bedrock_runtime.config import Config, HTTPAuthSchemeResolver, SigV4AuthScheme
from smithy_aws_core.credentials_resolvers.environment import EnvironmentCredentialsResolver

# from smithy_aws_core.auth.identity import DefaultAwsCredentialIdentityResolver
import boto3
import logging


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

session = boto3.Session()
creds = session.get_credentials()
frozen_creds = creds.get_frozen_credentials()

os.environ['AWS_ACCESS_KEY_ID'] = frozen_creds.access_key
os.environ['AWS_SECRET_ACCESS_KEY'] = frozen_creds.secret_key
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
        
        os.environ['AWS_ACCESS_KEY_ID'] = frozen_creds.access_key
        os.environ['AWS_SECRET_ACCESS_KEY'] = frozen_creds.secret_key
        if creds.token:
            os.environ['AWS_SESSION_TOKEN'] = creds.token
        
    def __init__(self, model_id='amazon.nova-sonic-v1:0', region='us-east-1'):
        self.refresh_env_credentials()
        os.environ['AWS_DEFAULT_REGION'] = region
        
        
        self.model_id = model_id
        self.region = region
        self.client = None
        self.stream = None
        self.response = None
        self.is_active = False
        self.prompt_name = str(uuid.uuid4())
        self.content_name = str(uuid.uuid4())
        self.audio_content_name = str(uuid.uuid4())
        self.role = None
        self.display_assistant_text = False

def _init_client(self):
    try:
        logger.info("🔄 Refreshing AWS credentials and initializing Bedrock client")
        session = boto3.Session()
        creds = session.get_credentials().get_frozen_credentials()

        # Write creds to environment
        os.environ['AWS_ACCESS_KEY_ID'] = creds.access_key
        os.environ['AWS_SECRET_ACCESS_KEY'] = creds.secret_key
        os.environ['AWS_DEFAULT_REGION'] = self.region
        if creds.token:
            os.environ['AWS_SESSION_TOKEN'] = creds.token
        else:
            os.environ.pop('AWS_SESSION_TOKEN', None)

        # Recreate the credentials resolver so smithy reloads env vars
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
            region=self.region,
            aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
            http_auth_scheme_resolver=HTTPAuthSchemeResolver(),
            http_auth_schemes={"aws.auth#sigv4": SigV4AuthScheme()},
        )
        self.client = BedrockRuntimeClient(config=config)
        logger.info("✅ Bedrock client initialized")
    except Exception as e:
        logger.error(f"Client init error: {str(e)}")

    async def start_session(self):
        self._init_client() # Comment out later, redeploy required
        if self.stream and self.is_active:
            return
            
        if not self.client:
            self._init_client()

        try:
            self.stream = await self.client.invoke_model_with_bidirectional_stream(
                InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
            )
            self.is_active = True
        except Exception as e:
            print(json.dumps({"type": "error", "text": f"Session start error: {str(e)}"}), flush=True)
            return

        # Session start
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
        
        # Prompt start with audio
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
        '''
        await self.send_event(prompt_start)

        # System prompt
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
        
        # Start response processing
        self.response = asyncio.create_task(self._process_responses())
        
        # Send prompt end to trigger initial response
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
        
        # Auto-start audio input after session is ready
        await asyncio.sleep(1.0)
        await self.start_audio_input()

    async def start_audio_input(self):
        if not self.stream:
            return
            
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
        try:
            if not self.is_active or not self.stream:
                return
                
            if len(audio_bytes) == 0:
                return
                
            # Encode audio as base64 and send as JSON event
            audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
            audio_input = f'''
            {{
                "event": {{
                    "audioInput": {{
                        "promptName": "{self.prompt_name}",
                        "contentName": "{self.audio_content_name}",
                        "content": "{audio_b64}"
                    }}
                }}
            }}
            '''
            await self.send_event(audio_input)
            
        except Exception as e:
            print(json.dumps({"type": "error", "text": f"Audio chunk error: {str(e)}"}), flush=True)
    
    async def end_audio_input(self):
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
        
        # Send prompt end to trigger response generation
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
        
        # Send prompt end to trigger response after audio
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

    async def _process_responses(self):
        try:
            while self.is_active:
                output = await self.stream.await_output()
                result = await output[1].receive()

                try:
                    decoded = result.value.bytes_.decode("utf-8")
                    json_data = json.loads(decoded)

                    if 'event' in json_data:
                        if 'textOutput' in json_data['event']:
                            text = json_data['event']['textOutput']['content']
                            print(json.dumps({"type": "text", "text": text}), flush=True)

                        elif 'audioOutput' in json_data['event']:
                            audio_content = json_data['event']['audioOutput']['content']
                            print(json.dumps({"type": "audio", "data": audio_content}), flush=True)

                        elif 'contentStart' in json_data['event']:
                            self.role = json_data['event']['contentStart'].get("role", "Unknown")

                except Exception as e:
                    pass
        except Exception as e:
            print(json.dumps({"type": "error", "text": f"Response processing error: {str(e)}"}), flush=True)

async def main():
    nova = NovaSonic()
    print(json.dumps({"type": "text", "text": "Nova Sonic ready!"}), flush=True)
    
    while True:
        try:
            line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
            if not line:
                break
                
            data = json.loads(line.strip())
            if data['type'] == 'start_session':
                await nova.start_session()
            elif data['type'] == 'start_audio':
                await nova.start_audio_input()
            elif data['type'] == 'audio':
                print(json.dumps({"type": "debug", "text": f"Processing audio chunk, size: {len(data['data'])}"}), flush=True)
                audio_bytes = base64.b64decode(data['data'])
                await nova.send_audio_chunk(audio_bytes)
            elif data['type'] == 'end_audio':
                print(json.dumps({"type": "debug", "text": "Ending audio input"}), flush=True)
                await nova.end_audio_input()
                
        except Exception as e:
            print(json.dumps({"type": "error", "text": str(e)}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())