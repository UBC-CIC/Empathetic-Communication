import asyncio
import json
import sys
import base64
import uuid
import random
import os
import boto3
import logging
import socketio
from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart
from aws_sdk_bedrock_runtime.config import Config, HTTPAuthSchemeResolver, SigV4AuthScheme
from smithy_aws_core.credentials_resolvers.environment import EnvironmentCredentialsResolver

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class SocketClient:
    def __init__(self, socket_url):
        self.sio = socketio.AsyncClient()
        self.socket_url = socket_url
        self.connected = False
        self.nova = None

    async def connect(self):
        try:
            await self.sio.connect(self.socket_url)
            self.connected = True
        except Exception as e:
            logger.error(f"Socket connection failed: {e}")

    async def start(self):
        await self.connect()
        await self.sio.wait()

    async def emit_audio_chunk(self, audio_bytes):
        if self.connected:
            audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
            await self.sio.emit('audio-chunk', {'data': audio_b64})

    async def emit_text_message(self, text):
        if self.connected:
            await self.sio.emit('text-message', {'text': text})

    def setup_handlers(self):
        @self.sio.event
        async def connect():
            logger.info("✅ Socket connected")

        @self.sio.event
        async def disconnect():
            logger.warning("❌ Socket disconnected")

        @self.sio.on("start-nova-sonic")
        async def handle_start():
            await self.nova.start_session()

        @self.sio.on("audio-input")
        async def handle_audio(data):
            audio_bytes = base64.b64decode(data["data"])
            await self.nova.send_audio_chunk(audio_bytes)

        @self.sio.on("end-audio")
        async def handle_end():
            await self.nova.end_audio_input()

class NovaSonic:
    def __init__(self, model_id='amazon.nova-sonic-v1:0', region='us-east-1', socket_client=None):
        self.model_id = model_id
        self.region = region
        self.client = None
        self.stream = None
        self.response = None
        self.is_active = False
        self.prompt_name = str(uuid.uuid4())
        self.content_name = str(uuid.uuid4())
        self.audio_content_name = str(uuid.uuid4())
        self.socket = socket_client
        self._init_client()

    def _init_client(self):
        try:
            logger.info("🔄 Refreshing AWS credentials and initializing Bedrock client")
            session = boto3.Session()
            creds = session.get_credentials().get_frozen_credentials()
            os.environ['AWS_ACCESS_KEY_ID'] = creds.access_key
            os.environ['AWS_SECRET_ACCESS_KEY'] = creds.secret_key
            os.environ['AWS_DEFAULT_REGION'] = self.region
            if creds.token:
                os.environ['AWS_SESSION_TOKEN'] = creds.token

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

    async def send_event(self, event_json):
        logger.debug(f"📤 Sending event: {event_json.strip()[:100]}...")
        event = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=event_json.encode('utf-8'))
        )
        await self.stream.input_stream.send(event)

    async def start_session(self):
        logger.info("🚀 Starting Nova Sonic session...")
        try:
            self.stream = await self.client.invoke_model_with_bidirectional_stream(
                InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
            )
            self.is_active = True
        except Exception as e:
            logger.error(f"Session start error: {str(e)}")
            return

        await self.send_event(json.dumps({"event": {"sessionStart": {"inferenceConfiguration": {"maxTokens": 1024, "topP": 0.9, "temperature": 0.7}}}}))
        await self.send_event(json.dumps({"event": {"promptStart": {"promptName": self.prompt_name,"textOutputConfiguration": {"mediaType": "text/plain"},"audioOutputConfiguration": {"mediaType": "audio/lpcm","sampleRateHertz": 24000,"sampleSizeBits": 16,"channelCount": 1,"voiceId": random.choice(["amy", "tiffany", "lupe"]),"encoding": "base64","audioType": "SPEECH"}}}}))
        await self.send_event(json.dumps({"event": {"contentStart": {"promptName": self.prompt_name,"contentName": self.content_name,"type": "TEXT","interactive": True,"role": "SYSTEM","textInputConfiguration": {"mediaType": "text/plain"}}}}))
        await self.send_event(json.dumps({"event": {"textInput": {"promptName": self.prompt_name,"contentName": self.content_name,"content": "You are a distressed patient with a condition you don't fully understand..."}}}))
        await self.send_event(json.dumps({"event": {"contentEnd": {"promptName": self.prompt_name,"contentName": self.content_name}}}))

        self.response = asyncio.create_task(self._process_responses())
        await asyncio.sleep(1)
        await self.start_audio_input()

    async def start_audio_input(self):
        await self.send_event(json.dumps({"event": {"contentStart": {"promptName": self.prompt_name,"contentName": self.audio_content_name,"type": "AUDIO","interactive": True,"role": "USER","audioInputConfiguration": {"mediaType": "audio/lpcm","sampleRateHertz": 16000,"sampleSizeBits": 16,"channelCount": 1,"audioType": "SPEECH","encoding": "base64"}}}}))

    async def send_audio_chunk(self, audio_bytes):
        logger.debug(f"🎧 Sending audio chunk, size={len(audio_bytes)} bytes")
        if self.is_active and self.stream and audio_bytes:
            chunk = InvokeModelWithBidirectionalStreamInputChunk(
                value=BidirectionalInputPayloadPart(bytes_=audio_bytes)
            )
            await self.stream.input_stream.send(chunk)

    async def end_audio_input(self):
        logger.info("🛑 Ending audio input")
        await self.send_event(json.dumps({"event": {"contentEnd": {"promptName": self.prompt_name, "contentName": self.audio_content_name}}}))
        await self.send_event(json.dumps({"event": {"promptEnd": {"promptName": self.prompt_name}}}))

    async def _process_responses(self):
        logger.info("🔄 Listening for Nova Sonic responses...")
        try:
            while self.is_active:
                output_stream = (await self.stream.await_output())[1]
                async for part in output_stream:
                    try:
                        decoded = part.value.bytes_.decode("utf-8")
                        logger.debug(f"📥 Raw response chunk: {decoded[:100]}...")
                        json_data = json.loads(decoded)
                        if 'event' in json_data:
                            if 'textOutput' in json_data['event']:
                                text = json_data['event']['textOutput']['content']
                                logger.info(f"💬 Text: {text}")
                                if self.socket:
                                    await self.socket.emit_text_message(text)
                            elif 'audioOutput' in json_data['event']:
                                audio = json_data['event']['audioOutput']['content']
                                logger.info(f"🔊 Audio chunk received")
                                if self.socket:
                                    await self.socket.emit_audio_chunk(base64.b64decode(audio))
                    except Exception as e:
                        logger.exception(f"Response parse error: {e}")
        except Exception as e:
            logger.exception(f"Response stream error: {e}")

if __name__ == '__main__':
    socket_url = os.getenv("SOCKET_URL", "http://localhost:3000")
    socket_client = SocketClient(socket_url)
    nova = NovaSonic(socket_client=socket_client)
    socket_client.nova = nova
    socket_client.setup_handlers()
    asyncio.run(socket_client.start())