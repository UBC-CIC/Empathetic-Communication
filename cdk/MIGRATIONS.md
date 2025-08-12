# Database Migrations with node-pg-migrate

## Quick Setup

1. **Install dependencies:**
   ```bash
   cd cdk
   npm install node-pg-migrate pg
   ```

2. **Create .env file:**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Use migrations:**
   ```bash
   # Create new migration
   npm run migrate:create add_new_table

   # Run migrations up
   npm run migrate:up

   # Rollback last migration
   npm run migrate:down
   ```

## Environment Variables

Set `DATABASE_URL` in your `.env` file:
```
DATABASE_URL=postgresql://username:password@host:5432/dbname
```

## Migration Files

- Migrations are stored in `migrations/` directory
- node-pg-migrate will auto-create this directory
- Your existing SQL files can be converted to JS migrations if needed