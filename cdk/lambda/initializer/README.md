# Database Migrations

This directory contains the database initialization and migration scripts for the Virtual Care Interaction project.

## How to Add New Tables or Modify Schema

To add new tables or modify the existing database schema, follow these steps:

1. Open the `migrations.py` file
2. Add a new migration entry in the `get_all_migrations()` function with an incremental version number
3. Write your SQL statements for the new migration

Example:

```python
# Add your new migrations here with incremental version numbers
migrations["003_add_new_feature_table"] = """
    CREATE TABLE IF NOT EXISTS "new_feature" (
        "id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
        "name" varchar NOT NULL,
        "description" text,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Add any foreign key relationships
    ALTER TABLE "new_feature" ADD FOREIGN KEY ("id") REFERENCES "another_table" ("id") ON DELETE CASCADE;
"""
```

## How Migrations Work

1. Each migration is tracked in a `schema_migrations` table in the database
2. Migrations are only applied once, even if you redeploy the stack multiple times
3. Migrations are applied in order based on their version number (e.g., 001, 002, 003)
4. If a migration fails, the transaction is rolled back to prevent partial schema changes

## Best Practices

1. Always use `CREATE TABLE IF NOT EXISTS` to avoid errors if the table already exists
2. For altering tables, use conditional logic to check if the column/constraint exists first
3. Keep migrations small and focused on a single change
4. Never modify existing migrations that have been deployed - create a new migration instead
5. Test your migrations locally before deploying to production

## Deployment

When you deploy or redeploy the database stack, the migrations will automatically run. The Lambda function is configured to run on every deployment, applying any new migrations that haven't been applied yet.