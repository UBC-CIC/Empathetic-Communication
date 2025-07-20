import os
import json
import boto3
import psycopg2
from psycopg2.extensions import AsIs
import logging
import re

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Dictionary to store migrations defined in code
CODE_MIGRATIONS = {}
# List to store migrations in order they should be applied
MIGRATION_ORDER = []

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

def get_next_migration_number(migrations=None):
    """Determine the next migration number based on existing migrations
    
    Args:
        migrations: Optional dictionary of existing migrations
        
    Returns:
        String with the next 3-digit migration number
    """
    if migrations is None:
        migrations = get_all_migrations()
        
    if not migrations:
        return "001"
    
    # Extract numbers from existing migration keys
    numbers = []
    for key in migrations.keys():
        parts = key.split('_')
        if parts and parts[0].isdigit():
            numbers.append(int(parts[0]))
    
    if not numbers:
        return "001"
        
    # Get the highest number and increment
    next_num = max(numbers) + 1
    return f"{next_num:03d}"  # Format as 3-digit string with leading zeros

def register_migration(name, sql):
    """Register a migration in the CODE_MIGRATIONS dictionary
    
    Args:
        name: Descriptive name for the migration
        sql: SQL to execute for this migration
        
    Returns:
        The migration key (name with version number)
    """
    # Add to the ordered list
    if name not in MIGRATION_ORDER:
        MIGRATION_ORDER.append(name)
    
    # Store the SQL
    CODE_MIGRATIONS[name] = sql
    return name

def get_empathy_flag_sql():
    """SQL for adding empathy_enabled flag to simulation_groups table"""
    return """
    DO $$
    BEGIN
        -- Check if the column exists
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='simulation_groups' AND column_name='empathy_enabled') THEN
            -- Add the column if it doesn't exist
            ALTER TABLE "simulation_groups" ADD COLUMN "empathy_enabled" BOOLEAN DEFAULT false;
        END IF;
    END $$;
    """

def get_update_feedback_table_sql():
    """SQL for updating the feedback table schema"""
    return """
    DO $$
    BEGIN
        -- Check if the old columns exist and new columns don't exist
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback' AND column_name='rating') AND
           NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='feedback' AND column_name='score') THEN
            
            -- Rename rating to score
            ALTER TABLE "feedback" RENAME COLUMN "rating" TO "score";
            
            -- Rename comments to analysis
            ALTER TABLE "feedback" RENAME COLUMN "comments" TO "analysis";
            
            -- Add the new areas_for_improvement column
            ALTER TABLE "feedback" ADD COLUMN "areas_for_improvement" varchar[];
        END IF;
    END $$;
    """

def get_all_migrations():
    """Return a dictionary of all migrations in order they should be applied"""
    # Initialize with the core schema if not already initialized
    if not CODE_MIGRATIONS:
        # Register the initial schema first
        register_migration("initial_schema", get_initial_schema())
        
        # Register additional migrations here
        register_migration("add_feedback_table", get_feedback_table_sql())
        register_migration("add_empathy_flag", get_empathy_flag_sql())
        register_migration("update_feedback_table", get_update_feedback_table_sql())
        # Add more migrations as needed
    
    # Create a new ordered dictionary with version numbers
    versioned_migrations = {}
    for i, name in enumerate(MIGRATION_ORDER):
        version = f"{i+1:03d}"  # Format as 3-digit string with leading zeros
        migration_key = f"{version}_{name}"
        versioned_migrations[migration_key] = CODE_MIGRATIONS[name]
    
    return versioned_migrations

def get_initial_schema():
    """Return the initial schema SQL"""
    return """
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

def get_feedback_table_sql():
    """SQL for creating the feedback table"""
    return """
    CREATE TABLE IF NOT EXISTS "feedback" (
        "feedback_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
        "session_id" uuid,
        "score" integer,
        "analysis" text,
        "areas_for_improvement" varchar[],
        "submitted_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("session_id") REFERENCES "sessions" ("session_id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    """

def add_migration(connection, migration_name, migration_sql):
    """Add a new migration to the system and run it
    
    Args:
        connection: Database connection
        migration_name: Descriptive name for the migration
        migration_sql: SQL to execute for this migration
        
    Returns:
        The migration key (name with version number)
    """
    # Register the migration
    register_migration(migration_name, migration_sql)
    
    # Get all migrations with version numbers
    migrations = get_all_migrations()
    
    # Find the key for this migration
    migration_key = None
    for key in migrations.keys():
        if key.endswith(f"_{migration_name}"):
            migration_key = key
            break
    
    if not migration_key:
        raise ValueError(f"Could not find migration key for {migration_name}")
    
    # Execute just this migration
    execute_migration(connection, migration_sql, migration_key)
    
    logger.info(f"Added and executed new migration: {migration_key}")
    
    return migration_key

def initialize_migration_tracking(connection):
    """Initialize migration tracking for existing deployments.
    This marks the initial schema as already applied if the tables already exist.
    """
    cursor = connection.cursor()
    
    try:
        # Check if the users table exists (as a proxy for determining if the initial schema was applied)
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'users'
            );
        """)
        users_table_exists = cursor.fetchone()[0]
        
        if users_table_exists:
            # Create the schema_migrations table if it doesn't exist
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS "schema_migrations" (
                    "id" SERIAL PRIMARY KEY,
                    "migration_name" VARCHAR(255) UNIQUE NOT NULL,
                    "applied_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            connection.commit()
            
            # Check if the initial schema migration is already recorded
            cursor.execute("SELECT COUNT(*) FROM schema_migrations WHERE migration_name = %s", ("001_initial_schema",))
            count = cursor.fetchone()[0]
            
            if count == 0:
                # Mark the initial schema as already applied
                cursor.execute(
                    "INSERT INTO schema_migrations (migration_name) VALUES (%s)",
                    ("001_initial_schema",)
                )
                connection.commit()
                logger.info("Marked initial schema as already applied for existing deployment")
    except Exception as e:
        connection.rollback()
        logger.error(f"Error in initialize_migration_tracking: {str(e)}")
    finally:
        cursor.close()

def run_migrations(connection):
    """Run all pending migrations"""
    # First, handle existing deployments by initializing migration tracking
    initialize_migration_tracking(connection)
    
    # Then run all pending migrations
    migrations = get_all_migrations()
    
    for name, sql in migrations.items():
        execute_migration(connection, sql, name)

# See README.md for instructions on how to add new tables