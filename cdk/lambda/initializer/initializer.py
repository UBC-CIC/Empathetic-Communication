import os
import json
import boto3
import psycopg2
from psycopg2.extensions import AsIs
import secrets

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

        #
        ## Create tables and schema
        ##

        # Create tables based on the schema
        sqlTableCreation = """
            CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

            CREATE TABLE IF NOT EXISTS "users" (
                "user_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "user_email" varchar UNIQUE,
                "username" varchar,
                "first_name" varchar,
                "last_name" varchar,
                "time_account_created" timestamp,
                "roles" varchar[],
                "last_sign_in" timestamp
            );

            CREATE TABLE IF NOT EXISTS "simulation_groups" (
                "simulation_group_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "group_name" varchar,
                "group_description" varchar,
                "group_access_code" varchar,
                "group_student_access" bool,
                "system_prompt" text,
                "empathy_enabled" bool default false
            );

            CREATE TABLE IF NOT EXISTS "patients" (
                "patient_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "simulation_group_id" uuid,
                "patient_name" varchar,
                "patient_age" integer,
                "patient_gender" varchar,
                "patient_number" integer,
                "patient_prompt" text,
                "llm_completion"  BOOLEAN DEFAULT TRUE
            );

            CREATE TABLE IF NOT EXISTS "enrolments" (
                "enrolment_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "user_id" uuid,
                "simulation_group_id" uuid,
                "enrolment_type" varchar,
                "group_completion_percentage" integer,
                "time_enroled" timestamp
            );

            CREATE TABLE IF NOT EXISTS "patient_data" (
                "file_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "patient_id" uuid,
                "filetype" varchar,
                "s3_bucket_reference" varchar,
                "filepath" varchar,
                "filename" varchar,
                "time_uploaded" timestamp,
                "metadata" text,
                "file_number" integer,
                "ingestion_status" VARCHAR(20) DEFAULT 'not processing'
            );

            CREATE TABLE IF NOT EXISTS "student_interactions" (
                "student_interaction_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "patient_id" uuid,
                "enrolment_id" uuid,
                "patient_score" integer,
                "last_accessed" timestamp,
                "patient_context_embedding" float[],
                "is_completed" BOOLEAN DEFAULT FALSE
            );

            CREATE TABLE IF NOT EXISTS "sessions" (
                "session_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "student_interaction_id" uuid,
                "session_name" varchar,
                "session_context_embeddings" float[],
                "last_accessed" timestamp,
                "notes" text
            );

            CREATE TABLE IF NOT EXISTS "messages" (
                "message_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "session_id" uuid,
                "student_sent" bool,
                "message_content" varchar,
                "time_sent" timestamp
            );

            CREATE TABLE IF NOT EXISTS "user_engagement_log" (
                "log_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
                "user_id" uuid,
                "simulation_group_id" uuid,
                "patient_id" uuid,
                "enrolment_id" uuid,
                "timestamp" timestamp,
                "engagement_type" varchar,
                "engagement_details" text
            );

            -- Add foreign key constraints
            ALTER TABLE "user_engagement_log" ADD FOREIGN KEY ("enrolment_id") REFERENCES "enrolments" ("enrolment_id") ON DELETE CASCADE ON UPDATE CASCADE;
            ALTER TABLE "user_engagement_log" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
            ALTER TABLE "user_engagement_log" ADD FOREIGN KEY ("simulation_group_id") REFERENCES "simulation_groups" ("simulation_group_id") ON DELETE CASCADE ON UPDATE CASCADE;
            ALTER TABLE "user_engagement_log" ADD FOREIGN KEY ("patient_id") REFERENCES "patients" ("patient_id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "patients" ADD FOREIGN KEY ("simulation_group_id") REFERENCES "simulation_groups" ("simulation_group_id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "enrolments" ADD FOREIGN KEY ("simulation_group_id") REFERENCES "simulation_groups" ("simulation_group_id") ON DELETE CASCADE ON UPDATE CASCADE;
            ALTER TABLE "enrolments" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "patient_data" ADD FOREIGN KEY ("patient_id") REFERENCES "patients" ("patient_id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "student_interactions" ADD FOREIGN KEY ("patient_id") REFERENCES "patients" ("patient_id") ON DELETE CASCADE ON UPDATE CASCADE;
            ALTER TABLE "student_interactions" ADD FOREIGN KEY ("enrolment_id") REFERENCES "enrolments" ("enrolment_id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "sessions" ADD FOREIGN KEY ("student_interaction_id") REFERENCES "student_interactions" ("student_interaction_id") ON DELETE CASCADE ON UPDATE CASCADE;

            ALTER TABLE "messages" ADD FOREIGN KEY ("session_id") REFERENCES "sessions" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE;

            -- Add unique constraint to enrolments
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'unique_simulation_group_user'
                    AND conrelid = '"enrolments"'::regclass
                ) THEN
                    ALTER TABLE "enrolments" ADD CONSTRAINT unique_simulation_group_user UNIQUE (simulation_group_id, user_id);
                END IF;
            END $$;
        """

        #
        ## Create users with limited permissions on RDS
        ##

        # Execute table creation
        cursor.execute(sqlTableCreation)
        connection.commit()

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

        print("Initialization completed")
    except Exception as e:
        print(e)