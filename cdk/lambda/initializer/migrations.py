import os
import json
import boto3
import psycopg2
from psycopg2.extensions import AsIs
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def execute_migration(connection, migration_sql, migration_name):
    """Execute a migration if it hasn't been applied yet"""
    cursor = connection.cursor()
    
    try:
        # Check if migrations table exists, if not create it
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS "schema_migrations" (
                "id" SERIAL PRIMARY KEY,
                "migration_name" VARCHAR(255) UNIQUE NOT NULL,
                "applied_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        connection.commit()
        
        # Check if this migration has been applied
        cursor.execute("SELECT COUNT(*) FROM schema_migrations WHERE migration_name = %s", (migration_name,))
        count = cursor.fetchone()[0]
        
        if count == 0:
            # Migration hasn't been applied yet
            logger.info(f"Applying migration: {migration_name}")
            cursor.execute(migration_sql)
            
            # Record that this migration has been applied
            cursor.execute("INSERT INTO schema_migrations (migration_name) VALUES (%s)", (migration_name,))
            connection.commit()
            logger.info(f"Migration {migration_name} applied successfully")
            return True
        else:
            logger.info(f"Migration {migration_name} already applied, skipping")
            return False
            
    except Exception as e:
        connection.rollback()
        logger.error(f"Error applying migration {migration_name}: {str(e)}")
        raise e
    finally:
        cursor.close()

def get_all_migrations():
    """Return a dictionary of all migrations in order they should be applied"""
    migrations = {}
    
    # Initial schema creation
    migrations["001_initial_schema"] = """
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
    
    # Add your new migrations here with incremental version numbers
    # Example:
    migrations["002_add_example_table"] = """
        CREATE TABLE IF NOT EXISTS "example_table" (
            "id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
            "name" varchar,
            "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
        );
    """
    
    # Add more migrations as needed
    
    return migrations

def run_migrations(connection):
    """Run all pending migrations"""
    migrations = get_all_migrations()
    
    for name, sql in migrations.items():
        execute_migration(connection, sql, name)