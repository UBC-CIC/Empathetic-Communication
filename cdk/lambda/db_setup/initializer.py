import os
import json
import boto3
import psycopg2
from psycopg2.extensions import AsIs
import secrets
import logging
# Import from the same directory
from migrations import run_migrations

logger = logging.getLogger()
logger.setLevel(logging.INFO)

DB_SECRET_NAME = os.environ["DB_SECRET_NAME"]
DB_USER_SECRET_NAME = os.environ["DB_USER_SECRET_NAME"]
DB_PROXY = os.environ["DB_PROXY"]
print(psycopg2.__version__)

# Global Secret Manager Client to avoid recreating multiple times
sm_client = boto3.client("secretsmanager")

def getDbSecret():
    # use secretsmanager client to get db credentials
    response = sm_client.get_secret_value(SecretId=DB_SECRET_NAME)["SecretString"]
    secret = json.loads(response)
    return secret

def createConnection():

    connection = psycopg2.connect(
        user=dbSecret["username"],
        password=dbSecret["password"],
        host=dbSecret["host"],
        dbname=dbSecret["dbname"],
        # sslmode="require"
    )
    return connection


dbSecret = getDbSecret()
connection = createConnection()

def handler(event, context):
    global connection
    if connection.closed:
        connection = createConnection()
    
    cursor = connection.cursor()
    try:
        logger.info("Starting database initialization and migrations")
        
        # Run all pending migrations
        run_migrations(connection)
        
        #
        ## Create users with limited permissions on RDS
        ##

        # Generate 16 bytes username and password randomly
        username = secrets.token_hex(8)
        password = secrets.token_hex(16)
        usernameTableCreator = secrets.token_hex(8)
        passwordTableCreator = secrets.token_hex(16)

        # Create new user roles
        sqlCreateUser = """
            DO $$
            BEGIN
                CREATE ROLE readwrite;
            EXCEPTION
                WHEN duplicate_object THEN
                    RAISE NOTICE 'Role already exists.';
            END
            $$;

            GRANT CONNECT ON DATABASE postgres TO readwrite;

            GRANT USAGE ON SCHEMA public TO readwrite;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO readwrite;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO readwrite;
            GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO readwrite;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO readwrite;

            CREATE USER "%s" WITH PASSWORD '%s';
            GRANT readwrite TO "%s";
        """
        
        sqlCreateTableCreator = """
            DO $$
            BEGIN
                CREATE ROLE tablecreator;
            EXCEPTION
                WHEN duplicate_object THEN
                    RAISE NOTICE 'Role already exists.';
            END
            $$;

            GRANT CONNECT ON DATABASE postgres TO tablecreator;

            GRANT USAGE, CREATE ON SCHEMA public TO tablecreator;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tablecreator;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tablecreator;
            GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO tablecreator;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO tablecreator;

            CREATE USER "%s" WITH PASSWORD '%s';
            GRANT tablecreator TO "%s";
        """

        # Execute user creation
        cursor.execute(
            sqlCreateUser,
            (
                AsIs(username),
                AsIs(password),
                AsIs(username),
            ),
        )
        connection.commit()
        cursor.execute(
            sqlCreateTableCreator,
            (
                AsIs(usernameTableCreator),
                AsIs(passwordTableCreator),
                AsIs(usernameTableCreator),
            ),
        )
        connection.commit()

        # Store credentials in Secrets Manager
        authInfoTableCreator = {"username": usernameTableCreator, "password": passwordTableCreator}
        dbSecret.update(authInfoTableCreator)
        sm_client.put_secret_value(SecretId=DB_PROXY, SecretString=json.dumps(dbSecret))

        # Store client username and password
        authInfo = {"username": username, "password": password}
        dbSecret.update(authInfo)
        sm_client.put_secret_value(SecretId=DB_USER_SECRET_NAME, SecretString=json.dumps(dbSecret))

        # Print sample queries to validate data
        sample_queries = [
            'SELECT * FROM "users";',
            'SELECT * FROM "simulation_groups";',
            'SELECT * FROM "patients";',
            'SELECT * FROM "enrolments";',
            'SELECT * FROM "patient_data";',
            'SELECT * FROM "student_interactions";',
            'SELECT * FROM "sessions";',
            'SELECT * FROM "messages";',
            'SELECT * FROM "user_engagement_log";'
        ]

        for query in sample_queries:
            cursor.execute(query)
            print(cursor.fetchall())

        # Close cursor and connection
        cursor.close()
        connection.close()

        logger.info("Initialization and migrations completed successfully")
    except Exception as e:
        print(e)