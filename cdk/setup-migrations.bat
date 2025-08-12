@echo off
echo Setting up node-pg-migrate...
cd /d "%~dp0"
npm install --prefix . --package-lock-only=false node-pg-migrate@^7.0.0 pg@^8.11.0
echo.
echo Setup complete! 
echo.
echo Copy .env.example to .env and update with your database credentials
echo Then run: npm run migrate:create your_migration_name