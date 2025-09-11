exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS "system_prompt_history" (
      "history_id" uuid PRIMARY KEY DEFAULT (uuid_generate_v4()),
      "prompt_content" text NOT NULL,
      "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("system_prompt_history", { ifExists: true, cascade: true });
};