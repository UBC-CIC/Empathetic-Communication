-- Add token limit and usage tracking to users table
ALTER TABLE "users" 
ADD COLUMN IF NOT EXISTS token_limit INTEGER DEFAULT 50000,
ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0;