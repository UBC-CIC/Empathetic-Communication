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
import langchain_chat_history
import psycopg2
from psycopg2 import pool
import uuid
from datetime import datetime
import logging
import requests
from langchain_aws import BedrockEmbeddings
from langchain_community.vectorstores import PGVector
# Set up basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Connection pool for better performance
pg_conn_pool = None
from threading import Lock
pool_lock = Lock()

# Audio config
INPUT_SAMPLE_RATE = 16000
OUTPUT_SAMPLE_RATE = 24000
CHANNELS = 1
CHUNK_SIZE = 1024

# STS credentials from Cognito will be passed via environment variables



def get_pg_connection():
    global pg_conn_pool
    with pool_lock:
        if pg_conn_pool is None:
            secrets_client = boto3.client('secretsmanager')
            db_secret_name = os.environ.get('SM_DB_CREDENTIALS')
            rds_endpoint = os.environ.get('RDS_PROXY_ENDPOINT')

            if not db_secret_name or not rds_endpoint:
                logger.warning("Database credentials not available")
                raise Exception("Database credentials not configured")

            secret_response = secrets_client.get_secret_value(SecretId=db_secret_name)
            secret = json.loads(secret_response['SecretString'])

            # Create connection pool
            pg_conn_pool = pool.SimpleConnectionPool(
                1, 5,  # min/max connections
                host=rds_endpoint,
                port=secret['port'],
                database=secret['dbname'],
                user=secret['username'],
                password=secret['password']
            )
        
        return pg_conn_pool.getconn()


class NovaSonic:

    def refresh_env_credentials(self):
        # Credentials already set by server.js via STS
        pass

    def __init__(self, model_id='amazon.nova-sonic-v1:0', region=None, socket_client=None, voice_id=None, session_id=None):
        self.user_id = os.getenv("USER_ID")
        self.model_id = model_id
        self.region = 'us-east-1'
        self.deployment_region = region or os.getenv('AWS_REGION', 'us-east-1')
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
        self.voice_id = voice_id
        self.session_id = session_id or os.getenv("SESSION_ID", "default")
        self.patient_name = os.getenv("PATIENT_NAME", "")
        self.patient_prompt = os.getenv("PATIENT_PROMPT", "")
        self.llm_completion = os.getenv("LLM_COMPLETION", "false").lower() == "true"
        self.extra_system_prompt = os.getenv("EXTRA_SYSTEM_PROMPT", "")
        self.patient_id = os.getenv("PATIENT_ID", "")
        # Cache system prompt and bedrock client
        self._cached_system_prompt = None
        self._bedrock_client = None
        self._chat_context = None
        self._current_user_input = ""

    def _init_client(self):
        """Initialize the Bedrock Client for Nova"""
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
            region=self.region,
            aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
            http_auth_scheme_resolver=HTTPAuthSchemeResolver(),
            http_auth_schemes={"aws.auth#sigv4": SigV4AuthScheme()},
        )
        self.client = BedrockRuntimeClient(config=config)
        print(f"Initialized Bedrock client for model {self.model_id} in region {self.region}")

    async def send_event(self, event: dict):
        """
        Given a Python dict, serialize it _without_ leading/trailing
        whitespace and send exactly one JSON object per chunk.
        """
        payload = json.dumps(event, separators=(",", ":"))
        chunk = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=payload.encode("utf-8"))
        )
        await self.stream.input_stream.send(chunk)

    def get_default_system_prompt(patient_name) -> str:
        """
        Generate the system prompt for the patient role.

        Returns:
        str: The formatted system prompt string.
        """
        system_prompt = f"""
        You are {patient_name or 'a patient'} and you are talking to a pharmacy student who is trying to help you.
        
        CRITICAL ROLE INSTRUCTIONS:
        - You are ONLY the patient - never switch roles or repeat what the student says
        - When the student speaks to you, respond as the patient would respond
        - Do NOT echo or repeat the student's words back to them
        - Do NOT act as the pharmacy student or provide medical advice
        - Stay in character as the patient at all times
        
        RESPONSE GUIDELINES:
        - Keep responses brief (1-2 sentences maximum)
        - Be realistic about your symptoms and concerns
        - Don't volunteer too much information at once
        - Ask questions a real patient would ask
        - Focus on how you're feeling physically
        - If the student shows empathy, respond naturally as a patient would
        
        WHAT TO AVOID:
        - Never repeat what the student just said
        - Don't switch to being the pharmacy student
        - Don't provide medical explanations
        - Don't break character
        
        Start by saying only "Hello." Then describe your symptoms when asked.
        """
        return system_prompt

    def get_system_prompt(self, patient_name=None, patient_prompt=None, llm_completion=None):
        """Cached system prompt retrieval"""
        if self._cached_system_prompt:
            return self._cached_system_prompt
            
        try:
            conn = get_pg_connection()
            cursor = conn.cursor()
            cursor.execute(
                'SELECT prompt_content FROM system_prompt_history ORDER BY created_at DESC LIMIT 1'
            )
            result = cursor.fetchone()
            cursor.close()
            pg_conn_pool.putconn(conn)
            
            if result and result[0]:
                self._cached_system_prompt = result[0]
                return self._cached_system_prompt
        except Exception as e:
            logger.error(f"Error retrieving system prompt: {e}")
            
        # Fallback to default
        self._cached_system_prompt = self.get_default_system_prompt(patient_name or self.patient_name)
        return self._cached_system_prompt



    async def start_session(self):
        """Start a new Nova Sonic session"""
        if not self.client:
            self._init_client()

        # Init stream
        self.stream = await self.client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
        )
        print("✅ Bidirectional stream initialized with Nova Sonic", flush=True)
        print(f"🗂️ Using session_id: {self.session_id}", flush=True)
        
        self.is_active = True

        # Send session start event

        # 1) sessionStart
        await self.send_event({
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
        })

        
        # Send prompt start event
        voice_ids = {"feminine": ["amy", "tiffany", "lupe"], "masculine": ["matthew", "carlos"]}
        
        # Use the voice ID from frontend if provided, otherwise select a random feminine voice
        selected_voice = self.voice_id if self.voice_id else random.choice(voice_ids['feminine'])
        
        # 2) promptStart
        await self.send_event({
        "event": {
            "promptStart": {
            "promptName": self.prompt_name,
            "textOutputConfiguration": {
                "mediaType": "text/plain"
            },
            "audioOutputConfiguration": {
                "mediaType": "audio/lpcm",
                "sampleRateHertz": 24000,
                "sampleSizeBits": 16,
                "channelCount": 1,
                "voiceId": selected_voice,
                "encoding": "base64",
                "audioType": "SPEECH"
            }
            }
        }
        })


        # 3) SYSTEM contentStart
        await self.send_event({
        "event": {
            "contentStart": {
            "promptName": self.prompt_name,
            "contentName": self.content_name,
            "type": "TEXT",
            "interactive": True,
            "role": "SYSTEM",
            "interrupt": True,
            "textInputConfiguration": {
                "mediaType": "text/plain"
            }
            }
        }
        })


        # Cache chat context to avoid repeated DB calls
        if not self._chat_context:
            self._chat_context = langchain_chat_history.format_chat_history(self.session_id)

        system_prompt = f"""
                        {self.get_system_prompt()}
                        {self._chat_context}
                        """
        
        # 4) textInput (your system prompt)
        await self.send_event({
        "event": {
            "textInput": {
            "promptName": self.prompt_name,
            "contentName": self.content_name,
            "content": system_prompt
            }
        }
        })


        # 5) contentEnd
        await self.send_event({
        "event": {
            "contentEnd": {
            "promptName": self.prompt_name,
            "contentName": self.content_name
            }
        }
        })


        # Start processing responses
        self.response = asyncio.create_task(self._process_responses())

        print(f"✅ Nova Sonic session started (Prompt ID: {self.prompt_name})", flush=True)
        # at the end of start_session() in nova_sonic.py
        print(json.dumps({ "type": "text", "text": "Nova Sonic ready" }), flush=True)



    async def start_audio_input(self):
        self.audio_content_name = str(uuid.uuid4())
        self._current_user_input = ""  # Track user input for empathy evaluation
        await self.send_event({
        "event": {
            "contentStart": {
            "promptName": self.prompt_name,
            "contentName": self.audio_content_name,
            "type": "AUDIO",
            "interactive": True,
            "role": "USER",
            "audioInputConfiguration": {
                "mediaType": "audio/lpcm",
                "sampleRateHertz": INPUT_SAMPLE_RATE,
                "sampleSizeBits": 16,
                "channelCount": CHANNELS,
                "audioType": "SPEECH",
                "encoding": "base64"
            }
            }
        }
        })
    
    async def send_audio_chunk(self, audio_bytes):
        blob = base64.b64encode(audio_bytes).decode("utf-8")
        await self.send_event({
        "event": {
            "audioInput": {
            "promptName": self.prompt_name,
            "contentName": self.audio_content_name,
            "content": blob
            }
        }
        })
    
    async def end_audio_input(self):
        await self.send_event({
        "event": {
            "contentEnd": {
            "promptName": self.prompt_name,
            "contentName": self.audio_content_name
            }
        }
        })
        
        # Trigger empathy evaluation for the completed user audio input if enabled
        if hasattr(self, '_current_user_input') and self._current_user_input and self._current_user_input.strip():
            print(f"🔍 DEBUG: Audio ended, user input: {self._current_user_input[:50]}...", flush=True)
            logger.info(f"🎤 AUDIO END - User input: {self._current_user_input[:30]}...")
            
            # Save user message to DB (CRITICAL for empathy coach review)
            print(f"💾 AUDIO END: Saving accumulated user input to DB", flush=True)
            asyncio.create_task(self._save_user_message_async(self._current_user_input))
            
            # CRITICAL: Direct empathy evaluation for voice input
            print(f"🧠 AUDIO END: Starting DIRECT empathy evaluation for voice input", flush=True)
            patient_context = f"Patient: {self.patient_name}, Condition: {self.patient_prompt}"
            
            # CRITICAL FIX: Capture the user input BEFORE creating async task to prevent race condition
            captured_user_input = self._current_user_input
            print(f"🔍 CRITICAL FIX: Captured user input: '{captured_user_input}'", flush=True)
            
            # Create empathy evaluation task with proper error handling
            async def safe_empathy_eval():
                try:
                    print(f"🧠 VOICE EMPATHY: Starting evaluation task", flush=True)
                    # CRITICAL DEBUG: Log exactly what we're passing
                    print(f"🔍 CRITICAL: About to pass to _evaluate_empathy: '{captured_user_input}'", flush=True)
                    print(f"🔍 CRITICAL: Patient context: '{patient_context}'", flush=True)
                    result = await self._evaluate_empathy(captured_user_input, patient_context)
                    if result:
                        print(f"🧠 VOICE EMPATHY: Evaluation completed successfully", flush=True)
                    else:
                        print(f"🧠 VOICE EMPATHY: Evaluation returned None", flush=True)
                except Exception as e:
                    print(f"🧠 VOICE EMPATHY: Evaluation failed with error: {e}", flush=True)
                    logger.error(f"Voice empathy evaluation error: {e}")
            
            asyncio.create_task(safe_empathy_eval())
            
            # CRITICAL DEBUG: Log before resetting
            print(f"🔍 CRITICAL: About to reset _current_user_input. Current value: '{self._current_user_input}'", flush=True)
            self._current_user_input = ""  # Reset for next input
            print(f"🔍 CRITICAL: After reset _current_user_input: '{self._current_user_input}'", flush=True)
        else:
            print(f"🔍 DEBUG: No user input to save at audio end - Input: '{getattr(self, '_current_user_input', 'NOT_SET')}'", flush=True)

    
    async def end_session(self):
        # promptEnd
        await self.send_event({
        "event": {
            "promptEnd": { "promptName": self.prompt_name }
        }
        })
        # sessionEnd
        await self.send_event({
        "event": { "sessionEnd": {} }
        })
        await self.stream.input_stream.close()
    
    async def handle_manual_empathy_evaluation(self, text, session_id=None):
        """Handle manual empathy evaluation requests from server.js"""
        try:
            print(f"🧠 MANUAL EMPATHY: Received request for text: {text[:50]}...", flush=True)
            logger.info(f"🧠 Manual empathy evaluation requested for: {text[:30]}...")
            
            # Use provided session_id or fall back to instance session_id
            eval_session_id = session_id or self.session_id
            
            # Save the user message first
            print(f"💾 MANUAL EMPATHY: Saving user message to DB", flush=True)
            await self._save_user_message_async(text)
            
            # Run empathy evaluation
            print(f"🧠 MANUAL EMPATHY: Starting empathy evaluation", flush=True)
            patient_context = f"Patient: {self.patient_name}, Condition: {self.patient_prompt}"
            empathy_result = await self._evaluate_empathy(text, patient_context)
            
            if empathy_result:
                print(f"🧠 MANUAL EMPATHY: Evaluation successful", flush=True)
                logger.info(f"🧠 Manual empathy evaluation completed successfully")
            else:
                print(f"🧠 MANUAL EMPATHY: Evaluation failed", flush=True)
                logger.warning(f"🧠 Manual empathy evaluation failed")
                
        except Exception as e:
            print(f"🧠 MANUAL EMPATHY ERROR: {e}", flush=True)
            logger.error(f"🧠 Manual empathy evaluation error: {e}")


    async def _process_responses(self):
        """Process responses from the stream, buffering partial JSON."""
        decoder = json.JSONDecoder()
        buffer = ""  # accumulate incoming text here

        try:
            while self.is_active:
                output = await self.stream.await_output()
                result = await output[1].receive()

                if not (result.value and result.value.bytes_):
                    continue

                # 1) Decode the raw bytes
                chunk = result.value.bytes_.decode("utf-8")
                buffer += chunk

                # 2) Try to peel off as many complete JSON objects as possible
                idx = 0
                while True:
                    try:
                        obj, offset = decoder.raw_decode(buffer[idx:])
                    except json.JSONDecodeError:
                        break
                    idx += offset
                    # 3) Hand off each parsed object
                    await self._handle_event(obj)

                # 4) Keep only the unparsed tail
                buffer = buffer[idx:]

        except Exception as e:
            print(f"🔥 Error in _process_responses(): {e}", flush=True)

    async def _handle_event(self, json_data):
        """Dispatch one parsed JSON event to your existing logic."""
        evt = json_data.get("event", {})
        
        # DEBUG: Log all events to see what Nova Sonic is sending
        print(f"🔍 DEBUG EVENT: {json.dumps(evt, indent=2)}", flush=True)
        
        # contentStart
        if "contentStart" in evt:
            content_start = evt["contentStart"]
            self.role = content_start.get("role")
            print(f"🔍 DEBUG ROLE SET: {self.role}", flush=True)
            # optional SPECULATIVE check
            if "additionalModelFields" in content_start:
                fields = json.loads(content_start["additionalModelFields"])
                self.display_assistant_text = (fields.get("generationStage") == "SPECULATIVE")

        # textOutput
        elif "textOutput" in evt:
            text = evt["textOutput"]["content"]
            
            print(f"🔍 DEBUG TEXT OUTPUT - Role: {self.role}, Text: {text[:50]}...", flush=True)
            
            # Filter only the specific interrupted JSON message
            if text.strip() == '{"interrupted": true}':
                print(f"Filtered interrupted message", flush=True)
                return
            
            # Check for diagnosis completion
            diagnosis_achieved = "SESSION COMPLETED" in text
            if diagnosis_achieved and self.llm_completion:
                # Remove the marker from the text
                text = text.replace("SESSION COMPLETED", "").strip()
                # Add completion message
                text += " I really appreciate your feedback. You may continue practicing with other patients. Goodbye."
            
            if self.role == "ASSISTANT":
                print(f"🔍 DEBUG: Processing ASSISTANT message", flush=True)
                print(f"Assistant: {text}", flush=True)
                print(json.dumps({"type": "text", "text": text}), flush=True)
                
                # If diagnosis achieved, signal completion
                if diagnosis_achieved and self.llm_completion:
                    print(json.dumps({"type": "diagnosis_complete", "text": "Session completed successfully"}), flush=True)

            elif self.role == "USER":
                print(f"🔍 DEBUG: Processing USER message - Text: {text}", flush=True)
                print(f"User: {text}", flush=True)
                print(json.dumps({"type": "text", "text": text}), flush=True)
                
                # CRITICAL FIX: Accumulate user input for empathy evaluation
                if not hasattr(self, '_current_user_input'):
                    self._current_user_input = ""
                    print(f"🔍 DEBUG: Initialized _current_user_input", flush=True)
                
                # CRITICAL: Ensure we're accumulating the actual text
                if text and text.strip():
                    self._current_user_input += text
                    print(f"🔍 CRITICAL: Added '{text}' to _current_user_input", flush=True)
                    print(f"🔍 CRITICAL: _current_user_input now: '{self._current_user_input}'", flush=True)
                    print(f"🔍 DEBUG: Accumulated user input now: {len(self._current_user_input)} chars", flush=True)
                else:
                    print(f"🔍 WARNING: Empty or whitespace-only text, not adding to _current_user_input", flush=True)
                
                # CRITICAL FIX: Save USER message to database immediately
                if text.strip():
                    print(f"💾 SAVING USER MESSAGE TO DB: {text[:50]}...", flush=True)
                    asyncio.create_task(self._save_user_message_async(text))
                    
                    print(f"🔍 DEBUG: Starting empathy check for USER text", flush=True)
                    logger.info(f"🧠 USER MESSAGE - Checking empathy: {text[:30]}...")
                    
                    # Use the direct empathy evaluation method for voice inputs
                    patient_context = f"Patient: {self.patient_name}, Condition: {self.patient_prompt}"
                    # CRITICAL DEBUG: Log what we're passing to empathy evaluation
                    print(f"🔍 DEBUG: About to evaluate empathy for text: '{text}'", flush=True)
                    asyncio.create_task(self._evaluate_empathy(text, patient_context))
                else:
                    print(f"🔍 DEBUG: Empty USER text, skipping empathy", flush=True)
                    logger.info(f"🧠 Empty user text, skipping empathy evaluation")
                    # Inline diagnosis evaluation
                    if self.llm_completion:
                        try:
                            bedrock_client = boto3.client("bedrock-runtime", region_name=self.deployment_region)
                            # Get answer key documents from vectorstore
                            try:
                                # Get DB credentials from environment
                                db_secret_name = os.getenv("SM_DB_CREDENTIALS")
                                rds_endpoint = os.getenv("RDS_PROXY_ENDPOINT")
                                
                                if db_secret_name and rds_endpoint:
                                    secrets_client = boto3.client('secretsmanager')
                                    secret_response = secrets_client.get_secret_value(SecretId=db_secret_name)
                                    secret = json.loads(secret_response['SecretString'])
                                    
                                    # Create embeddings
                                    embeddings = BedrockEmbeddings(model_id="amazon.titan-embed-text-v1", client=bedrock_client)
                                    
                                    # Connect to vectorstore
                                    connection_string = f"postgresql://{secret['username']}:{secret['password']}@{rds_endpoint}:{secret['port']}/{secret['dbname']}"
                                    vectorstore = PGVector(embedding_function=embeddings, collection_name=self.patient_id or 'default', connection_string=connection_string)
                                    
                                    # Search for relevant documents
                                    docs = vectorstore.similarity_search(text, k=3)
                                    doc_content = "\n".join([doc.page_content for doc in docs])
                                    
                                    prompt = f"""You are to answer the following question, and you MUST answer only one word which is either 'True' or 'False' with that exact wording, no extra words, only one of those. INFORMATION FOR THE QUESTION TO ANSWER: Based on the medical documents provided, is the student's diagnosis correct? Student said: {text}. Medical documents: {doc_content}"""
                                else:
                                    prompt = f"""You are to answer the following question, and you MUST answer only one word which is either 'True' or 'False' with that exact wording, no extra words, only one of those. INFORMATION FOR THE QUESTION TO ANSWER: Is the student's diagnosis correct? Student said: {text}."""
                            except Exception as vec_error:
                                logger.error(f"Vectorstore query failed: {vec_error}")
                                prompt = f"""You are to answer the following question, and you MUST answer only one word which is either 'True' or 'False' with that exact wording, no extra words, only one of those. INFORMATION FOR THE QUESTION TO ANSWER: Is the student's diagnosis correct? Student said: {text}."""
                            body = {"messages": [{"role": "user", "content": [{"text": prompt}]}], "inferenceConfig": {"temperature": 0.1}}
                            response = bedrock_client.invoke_model(modelId="amazon.nova-lite-v1:0", contentType="application/json", accept="application/json", body=json.dumps(body))
                            result = json.loads(response["body"].read())
                            verdict_text = result["output"]["message"]["content"][0]["text"].strip()
                            print(f"🩺 Diagnosis verdict: {verdict_text}", flush=True)
                            if verdict_text.lower() == "true":
                                print(json.dumps({"type": "diagnosis_verdict", "verdict": True}), flush=True)
                                # Send completion message to Nova Sonic
                                completion_msg = "SESSION COMPLETED. I really appreciate your feedback. You may continue practicing with other patients. Goodbye."
                                print(json.dumps({"type": "text", "text": completion_msg}), flush=True)
                        except Exception as e:
                            logger.error(f"Diagnosis evaluation failed: {e}")
                            # Fallback to us-east-1 for Nova models if deployment region fails
                            if self.deployment_region != 'us-east-1':
                                try:
                                    logger.info(f"Retrying diagnosis evaluation with us-east-1 fallback")
                                    bedrock_client = boto3.client("bedrock-runtime", region_name="us-east-1")
                                    body = {"messages": [{"role": "user", "content": [{"text": prompt}]}], "inferenceConfig": {"temperature": 0.1}}
                                    response = bedrock_client.invoke_model(modelId="amazon.nova-lite-v1:0", contentType="application/json", accept="application/json", body=json.dumps(body))
                                    result = json.loads(response["body"].read())
                                    verdict_text = result["output"]["message"]["content"][0]["text"].strip()
                                    if verdict_text.lower() == "true":
                                        print(json.dumps({"type": "diagnosis_verdict", "verdict": True}), flush=True)
                                        completion_msg = "SESSION COMPLETED. I really appreciate your feedback. You may continue practicing with other patients. Goodbye."
                                        print(json.dumps({"type": "text", "text": completion_msg}), flush=True)
                                except Exception as fallback_error:
                                    logger.error(f"Fallback diagnosis evaluation also failed: {fallback_error}")
                    # Skip diagnosis evaluation for now
                    # if self.llm_completion:
                    #     asyncio.create_task(self._evaluate_diagnosis_async(text))

            print(f"🔍 DEBUG: Final role processing - Role: {self.role}, Text length: {len(text)}", flush=True)
            logger.info(f"💬 [add_message] {self.role.upper()} | {self.session_id} | {text[:30]}")

            # Mirror to PostgreSQL
            try:
                normalized_role = "ai" if self.role and self.role.upper() == "ASSISTANT" else "user"
                langchain_chat_history.add_message(self.session_id, normalized_role, text)
                
                # Save ALL messages to messages table (both USER and ASSISTANT)
                if self.role and self.role.upper() == "ASSISTANT":
                    print(f"💾 SAVING ASSISTANT MESSAGE TO DB: {text[:50]}...", flush=True)
                    self._save_message_to_db(self.session_id, False, text, None)
                elif self.role and self.role.upper() == "USER":
                    print(f"💾 SAVING USER MESSAGE TO DB (BACKUP): {text[:50]}...", flush=True)
                    # Backup save in case async save fails
                    self._save_message_to_db(self.session_id, True, text, None)
                    
                logger.info(f"💬 [PG INSERT] {normalized_role.upper()} | {self.session_id} | {text[:30]}")
            except Exception as e:
                print(f"❌ Failed to insert message into PostgreSQL: {e}", flush=True)

        # audioOutput
        elif "audioOutput" in evt:
            b64 = evt["audioOutput"]["content"]
            audio_bytes = base64.b64decode(b64)
            await self.audio_queue.put(audio_bytes)
            print(json.dumps({
                "type": "audio",
                "data": b64,
                "size": len(audio_bytes)
            }), flush=True)

        # else: ignore other event types
    
    def _get_bedrock_client(self):
        """Cached bedrock client"""
        if not self._bedrock_client:
            self._bedrock_client = boto3.client("bedrock-runtime", region_name="us-east-1")
        return self._bedrock_client
    
    def _get_empathy_prompt(self):
        """Retrieve the latest empathy prompt from the empathy_prompt_history table."""
        try:
            logger.info("🔍 VOICE: RETRIEVING EMPATHY PROMPT FROM DATABASE")
            secrets_client = boto3.client('secretsmanager')
            db_secret_name = os.environ.get('SM_DB_CREDENTIALS')
            rds_endpoint = os.environ.get('RDS_PROXY_ENDPOINT')

            if not db_secret_name or not rds_endpoint:
                logger.warning("Database credentials not available for empathy prompt retrieval")
                return self._get_default_empathy_prompt()

            secret_response = secrets_client.get_secret_value(SecretId=db_secret_name)
            secret = json.loads(secret_response['SecretString'])

            conn = psycopg2.connect(
                host=rds_endpoint,
                port=secret['port'],
                database=secret['dbname'],
                user=secret['username'],
                password=secret['password']
            )
            cursor = conn.cursor()

            cursor.execute(
                'SELECT prompt_content, created_at FROM empathy_prompt_history ORDER BY created_at DESC LIMIT 1'
            )
            
            result = cursor.fetchone()
            cursor.close()
            conn.close()

            if result and result[0]:
                prompt_content = result[0]
                created_at = result[1]
                logger.info(f"🎯 VOICE: ADMIN EMPATHY PROMPT FOUND - Created: {created_at}")
                logger.info(f"🎯 VOICE: ADMIN PROMPT LENGTH: {len(prompt_content)} characters")
                
                # Check if prompt has required placeholders
                if '{patient_context}' not in prompt_content or '{user_text}' not in prompt_content:
                    logger.error("❌ VOICE: ADMIN PROMPT MISSING REQUIRED PLACEHOLDERS")
                    return self._get_default_empathy_prompt()
                
                # Fix JSON formatting issues - replace single braces with double braces in JSON template
                if '"empathy_score":' in prompt_content and '{{' not in prompt_content:
                    logger.info("🔧 VOICE: FIXING ADMIN PROMPT JSON FORMATTING")
                    import re
                    # More robust pattern to handle multiline JSON with whitespace
                    json_pattern = r'(\{[^{}]*?"empathy_score"[^{}]*?\})'
                    matches = re.findall(json_pattern, prompt_content, re.DOTALL)
                    
                    if matches:
                        for match in matches:
                            # Replace single braces with double braces for literal JSON
                            fixed_match = match.replace('{', '{{').replace('}', '}}')
                            prompt_content = prompt_content.replace(match, fixed_match)
                        logger.info("✅ VOICE: ADMIN PROMPT JSON FORMATTING FIXED")
                    else:
                        # Fallback: simple replacement for any JSON-like structure
                        logger.info("🔧 VOICE: APPLYING FALLBACK JSON FORMATTING")
                        prompt_content = re.sub(r'\{(\s*"empathy_score"[^}]*?)\}', r'{{\1}}', prompt_content, flags=re.DOTALL)
                        logger.info("✅ VOICE: FALLBACK JSON FORMATTING APPLIED")
                
                return prompt_content
            else:
                logger.info("🔧 VOICE: No admin prompt found, using default empathy prompt")
                return self._get_default_empathy_prompt()

        except Exception as e:
            logger.error(f"VOICE: Error retrieving empathy prompt from DB: {e}")
            logger.info("🔧 VOICE: Falling back to default empathy prompt")
            return self._get_default_empathy_prompt()
    
    def _get_default_empathy_prompt(self):
        """Default empathy evaluation prompt."""
        return """
You are an LLM-as-a-Judge for healthcare empathy evaluation. Your task is to assess, score, and provide detailed justifications for a pharmacy student's empathetic communication.

**EVALUATION CONTEXT:**
Patient Context: {patient_context}
Student Response: {user_text}

**JUDGE INSTRUCTIONS:**
As an expert judge, evaluate this response across multiple empathy dimensions. For each criterion, provide:
1. A score (1-5 scale)
2. Clear justification for the score
3. Specific evidence from the student's response
4. Actionable improvement recommendations

IMPORTANT: In your overall_assessment, address the student directly using 'you' language with an encouraging, supportive tone. Focus on growth and learning rather than criticism.

**SCORING CRITERIA:**

**Perspective-Taking (1-5):**
• 5-Extending: Exceptional understanding with profound insights into patient's viewpoint
• 4-Proficient: Clear understanding of patient's perspective with thoughtful insights
• 3-Competent: Shows awareness of patient's perspective with minor gaps
• 2-Advanced Beginner: Limited attempt to understand patient's perspective
• 1-Novice: Little or no effort to consider patient's viewpoint

**Emotional Resonance/Compassionate Care (1-5):**
• 5-Extending: Exceptional warmth, deeply attuned to emotional needs
• 4-Proficient: Genuine concern and sensitivity, warm and respectful
• 3-Competent: Expresses concern with slightly less empathetic tone
• 2-Advanced Beginner: Some emotional awareness but lacks warmth
• 1-Novice: Emotionally flat or dismissive response

**Acknowledgment of Patient's Experience (1-5):**
• 5-Extending: Deeply validates and honors patient's experience
• 4-Proficient: Clearly validates feelings in patient-centered way
• 3-Competent: Attempts validation with minor omissions
• 2-Advanced Beginner: Somewhat recognizes experience, lacks depth
• 1-Novice: Ignores or invalidates patient's feelings

**Language & Communication (1-5):**
• 5-Extending: Masterful therapeutic communication, perfectly tailored
• 4-Proficient: Patient-friendly, non-judgmental, inclusive language
• 3-Competent: Mostly clear and respectful, minor improvements needed
• 2-Advanced Beginner: Some unclear/technical language, minor judgmental tone
• 1-Novice: Overly technical, dismissive, or insensitive language

**Cognitive Empathy (Understanding) (1-5):**
Focus: Understanding patient's thoughts, perspective-taking, explaining information clearly
Evaluate: How well does the response demonstrate understanding of patient's viewpoint?

**Affective Empathy (Feeling) (1-5):**
Focus: Recognizing and responding to patient's emotions, providing emotional support
Evaluate: How well does the response show emotional attunement and comfort?

**Realism Assessment:**
• Realistic: Medically appropriate, honest, evidence-based responses
• Unrealistic: False reassurances, impossible promises, medical inaccuracies

**JUDGE OUTPUT FORMAT:**
Provide structured evaluation with detailed justifications for each score.

{{
    "empathy_score": <integer 1-5>,
    "perspective_taking": <integer 1-5>,
    "emotional_resonance": <integer 1-5>,
    "acknowledgment": <integer 1-5>,
    "language_communication": <integer 1-5>,
    "cognitive_empathy": <integer 1-5>,
    "affective_empathy": <integer 1-5>,
    "realism_flag": "realistic|unrealistic",
    "judge_reasoning": {{
        "perspective_taking_justification": "Detailed explanation for perspective-taking score with specific evidence",
        "emotional_resonance_justification": "Detailed explanation for emotional resonance score with specific evidence",
        "acknowledgment_justification": "Detailed explanation for acknowledgment score with specific evidence",
        "language_justification": "Detailed explanation for language score with specific evidence",
        "cognitive_empathy_justification": "Detailed explanation for cognitive empathy score",
        "affective_empathy_justification": "Detailed explanation for affective empathy score",
        "realism_justification": "Detailed explanation for realism assessment",
        "overall_assessment": "Supportive summary addressing the student directly using 'you' language with encouraging tone"
    }},
    "feedback": {{
        "strengths": ["Specific strengths with evidence from response"],
        "areas_for_improvement": ["Specific areas needing improvement with examples"],
        "why_realistic": "Judge explanation for realistic assessment (if applicable)",
        "why_unrealistic": "Judge explanation for unrealistic assessment (if applicable)",
        "improvement_suggestions": ["Actionable, specific improvement recommendations"],
        "alternative_phrasing": "Judge-recommended alternative phrasing for this scenario"
    }}
}}
"""
    

    

    
    async def _save_user_message_async(self, user_text):
        """Save user message to database asynchronously"""
        try:
            loop = asyncio.get_event_loop()
            print(f"💾 ASYNC SAVE: Starting save for user text: {user_text[:50]}...", flush=True)
            await loop.run_in_executor(None, self._save_message_to_db, self.session_id, True, user_text, None)
            # Also add to chat history
            await loop.run_in_executor(None, langchain_chat_history.add_message, self.session_id, "user", user_text)
            print(f"✅ ASYNC SAVE COMPLETE: User message saved to DB", flush=True)
            logger.info(f"💾 User audio message saved: {user_text[:30]}...")
        except Exception as e:
            print(f"❌ ASYNC SAVE FAILED: {e}", flush=True)
            logger.error(f"Failed to save user audio message: {e}")
    
    async def _evaluate_empathy(self, student_response, patient_context):
        """LLM-as-a-Judge empathy evaluation using admin-controlled prompt system"""
        print(f"🧠 VOICE: _evaluate_empathy CALLED with response: {student_response[:50]}...", flush=True)
        logger.info(f"🧠 VOICE: Starting empathy evaluation for: {student_response[:30]}...")
        
        # CRITICAL DEBUG: Log the raw inputs first
        logger.info(f"🔍 VOICE: RAW STUDENT RESPONSE: '{student_response}'")
        logger.info(f"🔍 VOICE: RAW PATIENT CONTEXT: '{patient_context}'")
        
        # Basic validation and sanitization
        if not student_response:
            logger.error(f"❌ VOICE: STUDENT RESPONSE IS NONE")
            return None
            
        # Clean the student response
        student_response = str(student_response).strip()
        
        if not student_response:
            logger.error(f"❌ VOICE: STUDENT RESPONSE IS EMPTY AFTER STRIP")
            return None
            
        if len(student_response) > 1000:  # Reasonable limit
            student_response = student_response[:1000]
            logger.warning(f"⚠️ VOICE: Truncated long student response to 1000 characters")
            
        # Ensure patient context is valid
        if not patient_context:
            patient_context = "General patient interaction"
            logger.warning(f"⚠️ VOICE: Using default patient context")
            
        # CRITICAL DEBUG: Log the cleaned inputs
        logger.info(f"🔍 VOICE: CLEANED STUDENT RESPONSE: '{student_response}'")
        logger.info(f"🔍 VOICE: CLEANED PATIENT CONTEXT: '{patient_context}'")
        logger.info(f"🔍 VOICE: RESPONSE LENGTH: {len(student_response)} characters")
        
        try:
            print(f"🧠 VOICE: Creating bedrock client for region: {self.deployment_region or 'us-east-1'}", flush=True)
            bedrock_client = boto3.client("bedrock-runtime", region_name=self.deployment_region or 'us-east-1')
            
            # Get admin-controlled empathy prompt (same as chat.py)
            empathy_prompt_template = self._get_empathy_prompt()
            logger.info(f"🎯 VOICE: EMPATHY PROMPT LENGTH: {len(empathy_prompt_template)} characters")
            
            # CRITICAL DEBUG: Log the exact inputs being used for evaluation
            logger.info(f"🔍 VOICE: FINAL PATIENT CONTEXT: {patient_context}")
            logger.info(f"🔍 VOICE: FINAL USER TEXT TO EVALUATE: '{student_response}'")
            logger.info(f"🔍 VOICE: FINAL USER TEXT LENGTH: {len(student_response)} characters")
            
            # CRITICAL: Final validation before processing
            if len(student_response.strip()) == 0:
                logger.error(f"❌ VOICE: STUDENT RESPONSE IS EMPTY AFTER FINAL STRIP")
                return None
                
            logger.info(f"✅ VOICE: PROCEEDING WITH EVALUATION - Response: '{student_response[:100]}...'")
            
            try:
                evaluation_prompt = empathy_prompt_template.format(
                    patient_context=patient_context,
                    user_text=student_response
                )
                logger.info(f"✅ VOICE: PROMPT FORMATTING SUCCESSFUL - Final prompt length: {len(evaluation_prompt)}")
                
                # CRITICAL VALIDATION: Ensure the user text was actually substituted
                if student_response not in evaluation_prompt:
                    logger.error(f"❌ VOICE: USER TEXT NOT FOUND IN FORMATTED PROMPT - This will cause hallucination!")
                    logger.error(f"❌ VOICE: Expected to find: '{student_response}'")
                    return None
                    
                # CRITICAL DEBUG: Log a sample of the formatted prompt to verify user text is included
                prompt_sample = evaluation_prompt[-500:] if len(evaluation_prompt) > 500 else evaluation_prompt
                logger.info(f"🔍 VOICE: PROMPT SAMPLE (last 500 chars): {prompt_sample}")
                logger.info(f"✅ VOICE: CONFIRMED USER TEXT IS IN PROMPT")
            except Exception as format_error:
                logger.error(f"❌ VOICE: ADMIN PROMPT FORMATTING ERROR: {format_error}")
                logger.error(f"❌ VOICE: FALLING BACK TO DEFAULT EMPATHY PROMPT")
                try:
                    default_prompt = self._get_default_empathy_prompt()
                    evaluation_prompt = default_prompt.format(
                        patient_context=patient_context,
                        user_text=student_response
                    )
                    logger.info(f"✅ VOICE: DEFAULT PROMPT FORMATTING SUCCESSFUL")
                    
                    # CRITICAL VALIDATION: Ensure user text is in default prompt too
                    if student_response not in evaluation_prompt:
                        logger.error(f"❌ VOICE: USER TEXT NOT FOUND IN DEFAULT PROMPT EITHER")
                        return None
                        
                    # CRITICAL DEBUG: Also log default prompt sample
                    prompt_sample = evaluation_prompt[-500:] if len(evaluation_prompt) > 500 else evaluation_prompt
                    logger.info(f"🔍 VOICE: DEFAULT PROMPT SAMPLE: {prompt_sample}")
                    logger.info(f"✅ VOICE: CONFIRMED USER TEXT IS IN DEFAULT PROMPT")
                except Exception as default_error:
                    logger.error(f"❌ VOICE: DEFAULT PROMPT ALSO FAILED: {default_error}")
                    return None
            
            print(f"🧠 VOICE: Sending evaluation prompt to Nova Pro", flush=True)
            
            body = {
                "messages": [{
                    "role": "user",
                    "content": [{"text": evaluation_prompt}]
                }],
                "inferenceConfig": {
                    "temperature": 0.1,
                    "maxTokens": 1200
                }
            }
            
            try:
                response = bedrock_client.invoke_model(
                    modelId="amazon.nova-pro-v1:0",
                    contentType="application/json",
                    accept="application/json",
                    body=json.dumps(body)
                )
                logger.info("✅ VOICE: BEDROCK MODEL CALL SUCCESSFUL")
            except Exception as model_error:
                logger.warning(f"VOICE: Nova Pro failed in deployment region, trying us-east-1: {model_error}")
                fallback_client = boto3.client("bedrock-runtime", region_name="us-east-1")
                response = fallback_client.invoke_model(
                    modelId="amazon.nova-pro-v1:0",
                    contentType="application/json",
                    accept="application/json",
                    body=json.dumps(body)
                )
                logger.info("✅ VOICE: BEDROCK FALLBACK CALL SUCCESSFUL")
            
            result = json.loads(response["body"].read())
            response_text = result["output"]["message"]["content"][0]["text"]
            logger.info(f"📝 VOICE: BEDROCK RESPONSE LENGTH: {len(response_text)} characters")
            
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            
            if json_start != -1 and json_end > json_start:
                json_text = response_text[json_start:json_end]
                logger.info(f"📝 VOICE: EXTRACTED JSON LENGTH: {len(json_text)} characters")
                
                empathy_result = json.loads(json_text)
                logger.info(f"✅ VOICE: JSON PARSING SUCCESSFUL - Keys: {list(empathy_result.keys())}")
                
                # Convert string scores to integers and validate (same as chat.py)
                required_scores = ['perspective_taking', 'emotional_resonance', 'acknowledgment', 'language_communication', 'cognitive_empathy', 'affective_empathy']
                for score_key in required_scores:
                    score_value = empathy_result.get(score_key)
                    if isinstance(score_value, str):
                        try:
                            empathy_result[score_key] = int(score_value)
                        except (ValueError, TypeError):
                            empathy_result[score_key] = 3
                    elif score_value is None or score_value == 0:
                        empathy_result[score_key] = 3
                
                if 'empathy_score' in empathy_result:
                    empathy_score = empathy_result.get('empathy_score')
                    if isinstance(empathy_score, str):
                        try:
                            empathy_result['empathy_score'] = int(empathy_score)
                        except (ValueError, TypeError):
                            empathy_result['empathy_score'] = 3
                
                empathy_result["evaluation_method"] = "LLM-as-a-Judge"
                empathy_result["judge_model"] = "amazon.nova-pro-v1:0"
                
                # Save to database
                self._save_message_to_db(self.session_id, True, student_response, empathy_result)
                
                # Send empathy feedback
                empathy_feedback = self._build_empathy_feedback(empathy_result)
                if empathy_feedback:
                    print(json.dumps({"type": "empathy", "content": empathy_feedback}), flush=True)
                    print(json.dumps({"type": "empathy_data", "content": json.dumps(empathy_result)}), flush=True)
                    logger.info(f"🧠 VOICE: Empathy feedback sent to frontend")
                
                logger.info(f"✅ VOICE: EMPATHY EVALUATION COMPLETED SUCCESSFULLY")
                return empathy_result
            else:
                logger.error(f"❌ VOICE: NO JSON FOUND IN RESPONSE: {response_text}")
                raise json.JSONDecodeError("No JSON found", response_text, 0)
                
        except json.JSONDecodeError as e:
            logger.error(f"❌ VOICE: JSON DECODE ERROR: {e}")
            return None
        except Exception as e:
            logger.error(f"❌ VOICE: EMPATHY EVALUATION ERROR: {e}")
            # Fallback: Save message without empathy data
            try:
                self._save_message_to_db(self.session_id, True, student_response, None)
                logger.info(f"🧠 VOICE: Message saved without empathy data as fallback")
            except Exception as save_error:
                logger.error(f"🧠 VOICE: Failed to save message as fallback: {save_error}")
            return None
    
    def _build_empathy_feedback(self, empathy_result):
        """Build formatted empathy feedback for display"""
        try:
            if not empathy_result:
                return None
                
            feedback = f"**🎤 Voice Empathy Coach:**\n\n"
            feedback += f"**Overall Empathy Score:** {empathy_result.get('empathy_score', 'N/A')}/5\n\n"
            
            # Add detailed scores
            scores = [
                ("Perspective-Taking", empathy_result.get('perspective_taking', 'N/A')),
                ("Emotional Resonance", empathy_result.get('emotional_resonance', 'N/A')),
                ("Acknowledgment", empathy_result.get('acknowledgment', 'N/A')),
                ("Language & Communication", empathy_result.get('language_communication', 'N/A')),
                ("Cognitive Empathy", empathy_result.get('cognitive_empathy', 'N/A')),
                ("Affective Empathy", empathy_result.get('affective_empathy', 'N/A'))
            ]
            
            for score_name, score_value in scores:
                feedback += f"**{score_name}:** {score_value}/5\n"
            
            # Add assessment
            if empathy_result.get('judge_reasoning', {}).get('overall_assessment'):
                feedback += f"\n**Assessment:** {empathy_result['judge_reasoning']['overall_assessment']}\n"
            
            # Add strengths
            strengths = empathy_result.get('feedback', {}).get('strengths', [])
            if strengths:
                feedback += f"\n**Strengths:**\n"
                for strength in strengths[:3]:  # Limit to 3 strengths
                    feedback += f"• {strength}\n"
            
            # Add improvement areas
            improvements = empathy_result.get('feedback', {}).get('areas_for_improvement', [])
            if improvements:
                feedback += f"\n**Areas for Improvement:**\n"
                for improvement in improvements[:3]:  # Limit to 3 improvements
                    feedback += f"• {improvement}\n"
            
            # Add suggestions
            suggestions = empathy_result.get('feedback', {}).get('improvement_suggestions', [])
            if suggestions:
                feedback += f"\n**Suggestions:**\n"
                for suggestion in suggestions[:2]:  # Limit to 2 suggestions
                    feedback += f"• {suggestion}\n"
            
            return feedback
            
        except Exception as e:
            logger.error(f"Error building empathy feedback: {e}")
            return None
    
    def _save_message_to_db(self, session_id, is_student, content, empathy_data):
        """Save message to database with enhanced error handling and logging"""
        try:
            print(f"💾 DB SAVE: Starting save - Student: {is_student}, Content: {content[:50]}...", flush=True)
            logger.info(f"💾 Starting DB save for {'student' if is_student else 'assistant'} message")
            
            conn = get_pg_connection()
            cursor = conn.cursor()
            
            # Insert into messages table
            insert_query = """
                INSERT INTO messages (session_id, student_sent, message_content, empathy_evaluation, time_sent) 
                VALUES (%s, %s, %s, %s, %s)
            """
            
            empathy_json = json.dumps(empathy_data) if empathy_data else None
            
            cursor.execute(insert_query, (
                session_id,
                is_student,
                content,
                empathy_json,
                datetime.now()
            ))
            
            conn.commit()
            cursor.close()
            pg_conn_pool.putconn(conn)
            
            print(f"✅ DB SAVE COMPLETE: Message saved to database", flush=True)
            logger.info(f"💾 Message saved to DB")
            
            # Also save to PostgreSQL chat history
            try:
                role = "user" if is_student else "assistant"
                langchain_chat_history.add_message(session_id, role, content)
                logger.info(f"💾 Saved message to PostgreSQL (session_id={session_id}, role={role})")
            except Exception as pg_error:
                logger.error(f"💾 Failed to save to PostgreSQL chat history: {pg_error}")
            
        except Exception as e:
            print(f"❌ DB SAVE FAILED: {e}", flush=True)
            logger.error(f"💾 Database save failed: {e}")
            raise e


# Main execution loop
if __name__ == "__main__":
    import sys
    import asyncio
    
    nova = None
    
    async def handle_stdin():
        """Handle commands from server.js via stdin"""
        global nova
        
        while True:
            try:
                line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
                if not line:
                    break
                    
                line = line.strip()
                if not line:
                    continue
                    
                try:
                    command = json.loads(line)
                    print(f"💬 STDIN COMMAND: {command.get('type', 'unknown')}", flush=True)
                    
                    if command["type"] == "start_session":
                        if nova:
                            await nova.end_session()
                        nova = NovaSonic(
                            session_id=command.get("session_id", "default"),
                            voice_id=command.get("voice_id"),
                        )
                        await nova.start_session()
                        
                    elif command["type"] == "start_audio" and nova:
                        await nova.start_audio_input()
                        
                    elif command["type"] == "audio" and nova:
                        audio_data = base64.b64decode(command["data"])
                        await nova.send_audio_chunk(audio_data)
                        
                    elif command["type"] == "end_audio" and nova:
                        await nova.end_audio_input()
                        
                    elif command["type"] == "evaluate_empathy" and nova:
                        # Handle manual empathy evaluation from server.js
                        print(f"🧠 STDIN: Processing empathy evaluation request", flush=True)
                        asyncio.create_task(nova.handle_manual_empathy_evaluation(
                            command["text"], 
                            command.get("session_id")
                        ))
                        
                    elif command["type"] == "text" and nova:
                        # Handle text input (if needed)
                        print(f"💬 TEXT INPUT: {command.get('data', '')[:50]}...", flush=True)
                        
                    elif command["type"] == "end_session" and nova:
                        await nova.end_session()
                        nova = None
                        
                except json.JSONDecodeError as je:
                    print(f"❌ JSON DECODE ERROR: {je} - Line: {line}", flush=True)
                except Exception as cmd_error:
                    print(f"❌ COMMAND ERROR: {cmd_error}", flush=True)
                    logger.error(f"Command processing error: {cmd_error}")
                    
            except Exception as e:
                print(f"❌ STDIN ERROR: {e}", flush=True)
                logger.error(f"Stdin handling error: {e}")
                break
    
    async def main():
        """Main async function"""
        global nova
        
        try:
            print(f"🚀 Nova Sonic Python process started", flush=True)
            logger.info("Nova Sonic process initialized")
            
            # Auto-start session if environment variables are present
            session_id = os.getenv("SESSION_ID", "default")
            voice_id = os.getenv("VOICE_ID")
            
            if session_id != "default":
                print(f"🚀 Auto-starting Nova Sonic session: {session_id}", flush=True)
                nova = NovaSonic(session_id=session_id, voice_id=voice_id)
                await nova.start_session()
            
            # Handle stdin commands
            await handle_stdin()
            
        except KeyboardInterrupt:
            print(f"🚫 Nova Sonic process interrupted", flush=True)
            logger.info("Nova Sonic process interrupted by user")
        except Exception as e:
            print(f"❌ Nova Sonic process error: {e}", flush=True)
            logger.error(f"Nova Sonic process error: {e}")
        finally:
            if nova:
                try:
                    await nova.end_session()
                except:
                    pass
            print(f"🚫 Nova Sonic process ended", flush=True)
            logger.info("Nova Sonic process ended")
    
    # Run the main async function
    asyncio.run(main())