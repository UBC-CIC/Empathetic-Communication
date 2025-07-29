# How to Add a New Table to the Database

This guide explains how to add a new table to the database in the Virtual Care Interaction project.

## Adding a New Table

To add a new tables/columns or alter/remove existing ones, you only need to modify the `migrations.py` file:

1. Define a function that returns the SQL for your new table
2. Register the migration in the `get_all_migrations()` function

### Example

```python
# 1. Define a function that returns the SQL for your new table
def get_analytics_table_sql():
    """SQL for creating the analytics table"""
    return """
    CREATE TABLE IF NOT EXISTS "analytics" (
        "analytics_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
        "user_id" uuid,
        "page_viewed" varchar,
        "time_spent" integer,
        "recorded_at" timestamp DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("user_id") REFERENCES "users" ("user_id") ON DELETE CASCADE ON UPDATE CASCADE
    );
    """

# 2. In the get_all_migrations function, add this line:
register_migration("add_analytics_table", get_analytics_table_sql())
```

That's it! The migration will be applied automatically during deployment.

## How It Works

- The system automatically assigns version numbers based on registration order
- Migrations are tracked in the database, so they're only applied once
- The system works in both new deployments and existing deployments
- No need to worry about file system access in Lambda environments

## Best Practices

- Use descriptive names for your migration functions and registrations
- Include `IF NOT EXISTS` in your CREATE TABLE statements
- For column additions, check if the column exists before adding it
- Always include appropriate foreign key constraints
- Test your migrations locally before deploying
