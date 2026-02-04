import os
import json
import boto3
import logging
import psycopg2
from psycopg2 import extensions
from langchain_aws import BedrockEmbeddings

from helpers.vectorstore import get_vectorstore_retriever
from helpers.chat import get_bedrock_llm, get_initial_student_query, get_student_query, create_dynamodb_history_table, get_response, update_session_name

# Set up basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Environment variables
DB_SECRET_NAME = os.environ["SM_DB_CREDENTIALS"]
REGION = os.environ["REGION"]
RDS_PROXY_ENDPOINT = os.environ["RDS_PROXY_ENDPOINT"]
BEDROCK_LLM_PARAM = os.environ["BEDROCK_LLM_PARAM"]
EMBEDDING_MODEL_PARAM = os.environ["EMBEDDING_MODEL_PARAM"]
TABLE_NAME_PARAM = os.environ["TABLE_NAME_PARAM"]
APPSYNC_GRAPHQL_URL = os.environ.get("APPSYNC_GRAPHQL_URL", "")

# AWS Clients
secrets_manager_client = boto3.client("secretsmanager")
ssm_client = boto3.client("ssm", region_name=REGION)
bedrock_runtime = boto3.client("bedrock-runtime", region_name=REGION)

# Cached resources
connection = None
db_secret = None
db_secret_version = None # tracking secret version for rotation detection
BEDROCK_LLM_ID = None
EMBEDDING_MODEL_ID = None
TABLE_NAME = None

# Cached embeddings instance
embeddings = None

def get_secret(secret_name, expect_json=True, force_refresh = False):
    global db_secret, db_secret_version
    if db_secret is None or force_refresh:
        try:
            response = secrets_manager_client.get_secret_value(SecretId=secret_name)
            new_version = response.get("VersionId")

            # rotation detection
            if db_secret_version and new_version != db_secret_version:
                logger.info(f"🔄 Secret rotation detected: {db_secret_version} -> {new_version}")
                global connection
                if connection:
                    try:
                        connection.close()
                    except:
                        pass
                    connection = None

            db_secret_version = new_version
            db_secret = json.loads(response["SecretString"]) if expect_json else response["SecretString"]
            logger.info(f"Secret loaded - version: {db_secret_version}")
        
        except json.JSONDecodeError as e:
            raise ValueError(f"Secret {secret_name} is not properly formatted as JSON.")
        except Exception as e:
            raise
    return db_secret


def get_parameter(param_name, cached_var):
    """
    Fetch a parameter value from Systems Manager Parameter Store.
    """
    if cached_var is None:
        try:
            response = ssm_client.get_parameter(Name=param_name, WithDecryption=True)
            cached_var = response["Parameter"]["Value"]
        except Exception as e:
            logger.error(f"Error fetching parameter {param_name}: {e}")
            raise
    return cached_var

def initialize_constants():
    global BEDROCK_LLM_ID, EMBEDDING_MODEL_ID, TABLE_NAME, embeddings
    BEDROCK_LLM_ID = get_parameter(BEDROCK_LLM_PARAM, BEDROCK_LLM_ID)
    EMBEDDING_MODEL_ID = get_parameter(EMBEDDING_MODEL_PARAM, EMBEDDING_MODEL_ID)
    TABLE_NAME = get_parameter(TABLE_NAME_PARAM, TABLE_NAME)

    if embeddings is None:
        embeddings = BedrockEmbeddings(
            model_id=EMBEDDING_MODEL_ID,
            client=bedrock_runtime,
            region_name=REGION,
        )
    
    create_dynamodb_history_table(TABLE_NAME)

def is_connection_alive(conn):
    # To test if the connection is actually usable
    if conn is None:
        return False
    try:
        if conn.closed:
            logger.info("Connection marked as closed")
            return False

        # checking transaction status - if in failed transaction, connection is bad
        if conn.status != extensions.STATUS_READY:
            logger.warning(f"Connection in bad state: {conn.status}")
            return False
        
        # Testing a simple query
        cur = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        return True

    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        logger.warning(f"⚠️ Connection health check failed (network issue): {e}")
        return False
    except Exception as e:
        logger.warning(f"⚠️ Connection health check failed (unexpected): {e}")
        return False

def get_db_connection():
    # Get or create a database connection through RDS Proxy with health check
    global connection

    # checking if the existing connection is alive
    if connection and is_connection_alive(connection):
        logger.info("Reusing existing connection")
        return connection
    
    # Close the dead connection if it exists
    if connection:
        try:
            logger.warning("Closing dead connection...")
            connection.close()
        except:
            pass

        connection = None
    
    # Try to create new connection with fresh credentials
    max_retries = 2
    for attempt in range(max_retries):
        try:
            # Force refresh secret on retry (in case of rotation)
            force_refresh = (attempt > 0)
            secret = get_secret(DB_SECRET_NAME, force_refresh=force_refresh)
            
            logger.info(f"🔌 Creating new connection to RDS Proxy (attempt {attempt + 1}/{max_retries})")
            connection = psycopg2.connect(
                dbname=secret["dbname"],
                user=secret["username"],
                password=secret["password"],
                host=RDS_PROXY_ENDPOINT,
                port=secret["port"],
                connect_timeout=5,
                options="-c statement_timeout=30000"  # 30 second query timeout
            )
            
            # ✅ CRITICAL: Enable autocommit to prevent transaction issues
            connection.autocommit = True
            
            logger.info("✅ Connected to database via RDS Proxy with autocommit enabled")
            return connection
            
        except psycopg2.OperationalError as e:
            error_msg = str(e).lower()
            
            # Check if it's an authentication error (possible rotation)
            if 'password' in error_msg or 'authentication' in error_msg:
                logger.warning(f"⚠️ Auth error on attempt {attempt + 1}, may be rotation: {e}")
                if attempt < max_retries - 1:
                    continue  # Retry with fresh credentials
            
            logger.error(f"❌ Failed to connect to database (attempt {attempt + 1}): {e}")
            connection = None
            
            if attempt == max_retries - 1:
                raise
                
        except Exception as e:
            logger.error(f"❌ Unexpected error connecting to database: {e}")
            connection = None
            raise
    
    raise Exception("Failed to establish database connection after all retries")


def get_system_prompt(simulation_group_id):
    # Fetch system prompt using shared connection
    cur = None

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute("""
            SELECT system_prompt
            FROM "simulation_groups"
            WHERE simulation_group_id = %s;
        """, (simulation_group_id,))

        result = cur.fetchone()
        logger.info(f"Query result: {result}")
        system_prompt = result[0] if result else None

        if system_prompt:
            logger.info(f"System prompt for simulation_group_id {simulation_group_id} found: {system_prompt}")
        else:
            logger.warning(f"No system prompt found for simulation_group_id {simulation_group_id}")

        return system_prompt

    except Exception as e:
        logger.error(f"Error fetching system prompt: {e}")
        # marking connection as bad so that it gets recreated
        global connection
        connection = None
        return None
    
    finally:
        if cur:
            try:
                cur.close()
            except:
                pass


def get_patient_details(patient_id):
    # Fetching patient details using shared connection
    cur = None

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        logger.info("Connected to RDS instance!")
        cur.execute("""
            SELECT patient_name, patient_age, patient_prompt, llm_completion
            FROM "patients"
            WHERE patient_id = %s;
        """, (patient_id,))

        result = cur.fetchone()
        logger.info(f"Query result: {result}")

        if result:
            patient_name, patient_age, patient_prompt, llm_completion = result
            logger.info(f"✅ Patient details found for patient_id {patient_id}")
            return patient_name, patient_age, patient_prompt, llm_completion
        else:
            logger.warning(f"⚠️ No patient found for patient_id {patient_id}")
            return None, None, None, None

    except Exception as e:
        logger.error(f"Error fetching patient details: {e}")
        # mark connection as bad so it gets recreated
        global connection
        connection = None
        return None, None, None
    
    finally:
        if cur:
            try:
                cur.close()
            except:
                pass




def handler(event, context):
    # Main Lambda handler with proper initialization and error handling
    # Version: 2026-02-04-rds-proxy-autocommit-fix
    logger.info("🚀 STREAMING FUNCTION STARTED - Text Generation Lambda function is called!")
    logger.info("🔧 EMPATHY EVALUATION SYSTEM LOADED")
    logger.info(f"📝 Event headers: {event.get('headers', {})}")
    logger.info(f"🔍 FULL EVENT: {json.dumps(event, default=str)}")
    initialize_constants()
    
    try:
        # initialize all cached resources ONCE per container (not per invocation)
        initialize_constants()
        # ensure we have a working database connection, this will reuse existing conn or create new one if needed
        get_db_connection()

        # Extract the user's Cognito token from the API Gateway event
        auth_token = None
        if 'headers' in event:
            headers = event['headers']
            auth_token = headers.get('Authorization') or headers.get('authorization')
            logger.info(f"🔍 Found headers: {list(headers.keys())}")
        
        if auth_token:
            logger.info(f"🎫 Raw auth token: {auth_token[:30]}...")
            # Extract JWT token from Bearer format if present
            if auth_token.startswith('Bearer '):
                jwt_token = auth_token[7:]  # Remove 'Bearer ' prefix
            else:
                jwt_token = auth_token
            
            # Store the JWT token for AppSync authentication
            from helpers.chat import get_cognito_token
            get_cognito_token.current_token = f"Bearer {jwt_token}"
            logger.info(f"✅ Cognito JWT token extracted and stored: Bearer {jwt_token[:20]}...")
        else:
            logger.warning(f"❌ No Authorization header found. Available headers: {list(headers.keys()) if 'headers' in locals() else 'No headers'}")

        query_params = event.get("queryStringParameters", {})
        simulation_group_id = query_params.get("simulation_group_id", "")
        session_id = query_params.get("session_id", "")
        patient_id = query_params.get("patient_id", "")
        session_name = query_params.get("session_name", "New Chat")

        if not simulation_group_id or not session_id or not patient_id:
            return {
                'statusCode': 400,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                'body': json.dumps("Missing required parameters: simulation_group_id, session_id, or patient_id")
            }

        system_prompt = get_system_prompt(simulation_group_id)
        if system_prompt is None:
            logger.error(f"Error fetching system prompt for simulation_group_id: {simulation_group_id}")
            return {
                'statusCode': 400,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                'body': json.dumps('Error fetching system prompt')
            }

        patient_name, patient_age, patient_prompt, llm_completion = get_patient_details(
            patient_id)
        if patient_name is None or patient_age is None or patient_prompt is None or llm_completion is None:
            return {
                'statusCode': 400,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                'body': json.dumps('Error fetching patient details')
            }

        body = {} if event.get("body") is None else json.loads(event.get("body"))
        question = body.get("message_content", "")
        
        logger.info(f"🔍 RAW BODY: {event.get('body')}")
        logger.info(f"🔍 PARSED BODY: {body}")
        logger.info(f"🔍 QUESTION: '{question}'")

        if not question:
            logger.info(f"Start of conversation. Creating conversation history table in DynamoDB.")
            student_query = get_initial_student_query(patient_name)
        else:
            logger.info(f"Processing student question: {question}")
            student_query = get_student_query(question)
            
        logger.info(f"🔍 FINAL STUDENT QUERY: '{student_query}'")
        


        # Check if streaming is requested
        query_params = event.get("queryStringParameters", {})
        stream = query_params.get("stream", "false").lower() == "true"
        
        try:
            logger.info("Creating Bedrock LLM instance.")
            llm = get_bedrock_llm(bedrock_llm_id=BEDROCK_LLM_ID, streaming=stream)
        except Exception as e:
            logger.error(f"Error getting LLM from Bedrock: {e}")
            return {
                'statusCode': 500,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                'body': json.dumps('Error getting LLM from Bedrock')
            }

        try:
            logger.info("Retrieving vectorstore config.")
            db_secret = get_secret(DB_SECRET_NAME)
            vectorstore_config_dict = {
                'collection_name': patient_id,
                'dbname': db_secret["dbname"],
                'user': db_secret["username"],
                'password': db_secret["password"],
                'host': RDS_PROXY_ENDPOINT,
                'port': db_secret["port"]
            }
        except Exception as e:
            logger.error(f"Error retrieving vectorstore config: {e}")
            return {
                'statusCode': 500,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                'body': json.dumps('Error retrieving vectorstore config')
            }

        try:
            logger.info("Creating history-aware retriever.")

            history_aware_retriever = get_vectorstore_retriever(
                llm=llm,
                vectorstore_config_dict=vectorstore_config_dict,
                embeddings=embeddings
            )
        except Exception as e:
            logger.error(f"Error creating history-aware retriever: {e}")
            return {
                'statusCode': 500,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                'body': json.dumps('Error creating history-aware retriever')
            }

        try:
            logger.info("Generating response from the LLM.")
            
            logger.info(f"🚀 CALLING get_response with query: '{student_query}'")
            response = get_response(
                query=student_query,
                patient_name=patient_name,
                llm=llm,
                history_aware_retriever=history_aware_retriever,
                table_name=TABLE_NAME,
                session_id=session_id,
                system_prompt=system_prompt,
                patient_age=patient_age,
                patient_prompt=patient_prompt,
                llm_completion=llm_completion,
                stream=stream
            )
        except Exception as e:
            logger.error(f"Error getting response: {e}")
            logger.exception("Full error details:")
            return {
                'statusCode': 500,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                'body': json.dumps(f'Error getting response: {str(e)}')
            }

        try:
            logger.info("Updating session name if this is the first exchange between the LLM and student")
            potential_session_name = update_session_name(
                TABLE_NAME, session_id, BEDROCK_LLM_ID, patient_name)
            if potential_session_name:
                logger.info("This is the first exchange between the LLM and student. Updating session name.")
                session_name = potential_session_name
            else:
                logger.info("Not the first exchange between the LLM and student. Session name remains the same.")
        except Exception as e:
            logger.error(f"Error updating session name: {e}")
            session_name = "New Chat"
        


        if stream:
            logger.info("Returning streaming response.")
            return {
                "statusCode": 200,
                "headers": {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                "body": json.dumps(response),
                "isBase64Encoded": False
            }
        else:
            logger.info("Returning the generated response.")
            empathy_eval = response.get('empathy_evaluation', None)
            logger.info(f"LLM RESPONSE: {empathy_eval}")
            return {
                "statusCode": 200,
                "headers": {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Headers": "*",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "*",
                },
                "body": json.dumps({
                    "session_name": session_name,
                    "llm_output": response.get("llm_output", "LLM failed to create response"),
                    "llm_verdict": response.get("llm_verdict", "LLM failed to create verdict"),
                    "empathy_evaluation": response.get("empathy_evaluation", None)
                })
            }
    
    except Exception as e:
        logger.error(f"Unhandled error in text generation handler: {e}")
        logger.exception("Full traceback: ")
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "*"
            },
            "body": json.dumps(
                f'Internal Server Error: {str(e)}'
            )  
        }