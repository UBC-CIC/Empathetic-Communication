import os
import asyncio
import base64
import json
import uuid
import random
import sys

from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart
from aws_sdk_bedrock_runtime.config import Config, HTTPAuthSchemeResolver, SigV4AuthScheme
from smithy_aws_core.credentials_resolvers.environment import EnvironmentCredentialsResolver

# Audio config
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
CHANNELS = 1
CHUNK_SIZE = 1024

class NovaSonic:
    def __init__(self, model_id='amazon.nova-sonic-v1:0', region='us-east-1'):
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

    def _init_client(self):
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
            region=self.region,
            aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
            http_auth_scheme_resolver=HTTPAuthSchemeResolver(),
            http_auth_schemes={"aws.auth#sigv4": SigV4AuthScheme()},
        )
        self.client = BedrockRuntimeClient(config=config)

    async def send_event(self, event_json):
        event = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=event_json.encode('utf-8'))
        )
        await self.stream.input_stream.send(event)

    async def start_session(self):
        if not self.client:
            self._init_client()

        self.stream = await self.client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
        )
        self.is_active = True

        await self.send_event(json.dumps({
            "event": {
                "sessionStart": {
                    "inferenceConfiguration": {
                        "maxTokens": 1024,
                        "topP": 0.9,
                        "temperature": 0.7
                    }
                }
            }
        }))

        voice_ids = {"feminine": ["amy", "tiffany", "lupe"], "masculine": ["matthew", "carlos"]}

        await self.send_event(json.dumps({
            "event": {
                "promptStart": {
                    "promptName": self.prompt_name,
                    "textOutputConfiguration": {"mediaType": "text/plain"},
                    "audioOutputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 24000,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "voiceId": random.choice(voice_ids["feminine"]),
                        "encoding": "base64",
                        "audioType": "SPEECH"
                    }
                }
            }
        }))

        await self.send_event(json.dumps({
            "event": {
                "contentStart": {
                    "promptName": self.prompt_name,
                    "contentName": self.content_name,
                    "type": "TEXT",
                    "interactive": True,
                    "role": "SYSTEM",
                    "textInputConfiguration": {"mediaType": "text/plain"}
                }
            }
        }))

        await self.send_event(json.dumps({
            "event": {
                "textInput": {
                    "promptName": self.prompt_name,
                    "contentName": self.content_name,
                    "content": (
                        "You are to act as a concerned patient with a diagnosis (choose a random disease, pretend like you're "
                        "not aware what it is until I say 'simulation over' and ask about it). I will ask you questions to help diagnose "
                        "your condition. Please answer as accurately as possible. Sound distressed if you are in pain or uncomfortable. "
                        "If you are not in distress, please respond calmly and clearly."
                    )
                }
            }
        }))

        await self.send_event(json.dumps({
            "event": {
                "contentEnd": {
                    "promptName": self.prompt_name,
                    "contentName": self.content_name
                }
            }
        }))

        self.response = asyncio.create_task(self._process_responses())
        print(json.dumps({"type": "text", "text": "Nova Sonic ready"}), flush=True)

    async def start_audio_input(self):
        await self.send_event(json.dumps({
            "event": {
                "contentStart": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name,
                    "type": "AUDIO",
                    "interactive": True,
                    "role": "USER",
                    "audioInputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 16000,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "audioType": "SPEECH",
                        "encoding": "base64"
                    }
                }
            }
        }))

    async def send_audio_chunk(self, audio_bytes):
        if not self.is_active:
            return
        blob = base64.b64encode(audio_bytes).decode("utf-8")
        await self.send_event(json.dumps({
            "event": {
                "audioInput": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name,
                    "content": blob
                }
            }
        }))

    async def end_audio_input(self):
        await self.send_event(json.dumps({
            "event": {
                "contentEnd": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name
                }
            }
        }))

    async def end_session(self):
        if not self.is_active:
            return
        await self.send_event(json.dumps({
            "event": {"promptEnd": {"promptName": self.prompt_name}}
        }))
        await self.send_event(json.dumps({"event": {"sessionEnd": {}}}))
        await self.stream.input_stream.close()

    async def _process_responses(self):
        try:
            while self.is_active:
                output = await self.stream.await_output()
                result = await output[1].receive()

                if result.value and result.value.bytes_:
                    data = json.loads(result.value.bytes_.decode("utf-8"))
                    if "event" in data:
                        if "textOutput" in data["event"]:
                            print(json.dumps({"type": "text", "text": data["event"]["textOutput"]["content"]}), flush=True)
                        elif "audioOutput" in data["event"]:
                            print(json.dumps({"type": "audio", "data": data["event"]["audioOutput"]["content"]}), flush=True)
        except Exception as e:
            print(json.dumps({"type": "error", "message": str(e)}), flush=True)

async def read_stdin_loop(nova):
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

    await nova.start_session()
    await nova.start_audio_input()

    try:
        while nova.is_active:
            line = await reader.readline()
            if not line:
                break
            try:
                msg = json.loads(line.decode("utf-8"))
                if msg.get("type") == "audio":
                    await nova.send_audio_chunk(base64.b64decode(msg["data"]))
                elif msg.get("type") == "text":
                    await nova.send_event(json.dumps({
                        "event": {
                            "textInput": {
                                "promptName": nova.prompt_name,
                                "contentName": nova.content_name,
                                "content": msg["data"]
                            }
                        }
                    }))
                elif msg.get("type") == "end_audio":
                    await nova.end_audio_input()
            except Exception as e:
                print(json.dumps({"type": "error", "message": str(e)}), flush=True)
    finally:
        await nova.end_session()

if __name__ == "__main__":
    asyncio.run(read_stdin_loop(NovaSonic()))
