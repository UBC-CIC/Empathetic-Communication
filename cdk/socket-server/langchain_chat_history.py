import json
import os
from langchain_community.chat_message_histories import DynamoDBChatMessageHistory
from langchain_core.messages import AIMessage, HumanMessage
import psycopg2
import logging
import boto3
import uuid
from datetime import datetime

# Set up basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

connection = None
db_secret = None

secrets_manager_client = boto3.client("secretsmanager")

RDS_PROXY_ENDPOINT = os.environ.get("RDS_PROXY_ENDPOINT")  # Replace with your actual RDS proxy endpoint
DB_SECRET_NAME = os.environ.get("SM_DB_CREDENTIALS")  # Replace with your actual secret name
print(f"Using RDS Proxy Endpoint: {RDS_PROXY_ENDPOINT}")
print(f"Using DB Secret Name: {DB_SECRET_NAME}")
logger.info(f"Using RDS Proxy Endpoint: {RDS_PROXY_ENDPOINT}")
logger.info(f"Using DB Secret Name: {DB_SECRET_NAME}")

def format_chat_history(session_id: str, table_name: str = "DynamoDB-Conversation-Table") -> str:
    history = DynamoDBChatMessageHistory(table_name=table_name, session_id=session_id)
    recent_messages = history.messages[-10:]

    lines = []
    for m in recent_messages:
        role = "User" if m.type == "human" else "Assistant"
        content = m.content.strip().replace("\n", " ")
        safe_content = json.dumps(content)[1:-1]  # escape but remove outer quotes
        lines.append(f"{role}: {safe_content}")
    return "\n".join(lines)

def add_message(session_id: str, role: str, content: str, table_name: str = "DynamoDB-Conversation-Table"):
    history = DynamoDBChatMessageHistory(table_name=table_name, session_id=session_id)
    if role == "user":
        history.add_message(HumanMessage(content=content))
    elif role == "ai":
        history.add_message(AIMessage(content=content))
    else:
        raise ValueError(f"Invalid role '{role}'. Must be 'user' or 'ai'.")

    # Mirror to PostgreSQL
    try:
        insert_message_to_postgres(session_id, role, content)
    
    except Exception as e:
        logger.error(f"❌ Failed to insert message into PostgreSQL: {e}")


def get_secret(secret_name, expect_json=True):
    global db_secret
    if db_secret is None:
        try:
            response = secrets_manager_client.get_secret_value(SecretId=secret_name)["SecretString"]
            db_secret = json.loads(response) if expect_json else response
        except json.JSONDecodeError as e:
            logger.error(f"Failed to decode JSON for secret {secret_name}: {e}")
            raise ValueError(f"Secret {secret_name} is not properly formatted as JSON.")
        except Exception as e:
            logger.error(f"Error fetching secret {secret_name}: {e}")
            raise
    return db_secret

def connect_to_db():
    global connection
    if connection is None or connection.closed:
        try:
            secret = get_secret(DB_SECRET_NAME)
            connection_params = {
                'dbname': secret["dbname"],
                'user': secret["username"],
                'password': secret["password"],
                'host': RDS_PROXY_ENDPOINT,
                'port': secret["port"]
            }
            connection_string = " ".join([f"{key}={value}" for key, value in connection_params.items()])
            connection = psycopg2.connect(connection_string)
            logger.info("Connected to the database!")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            if connection:
                connection.rollback()
                connection.close()
            raise
    return connection

def insert_message_to_postgres(session_id: str, role: str, content: str):
    try:
        conn = connect_to_db()
        cursor = conn.cursor()

        insert_query = """
            INSERT INTO messages (message_id, session_id, student_sent, message_content, time_sent)
            VALUES (%s, %s, %s, %s, %s);
        """
        cursor.execute(insert_query, (
            str(uuid.uuid4()),
            session_id,
            True if role == "user" else False,
            content,
            datetime.utcnow()
        ))
        conn.commit()
        cursor.close()
        logger.info(f"💾 Saved message to PostgreSQL (session_id={session_id}, role={role})")

    except Exception as e:
        logger.error(f"❌ Failed to insert message: {e}")
        print(f"❌ Failed to insert message: {e}")
        conn.rollback()

