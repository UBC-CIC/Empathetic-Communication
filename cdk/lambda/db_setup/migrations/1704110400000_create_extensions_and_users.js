exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "vector"');
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS users (
      user_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_email varchar UNIQUE,
      username varchar,
      first_name varchar,
      last_name varchar,
      time_account_created timestamptz NOT NULL DEFAULT now(),
      roles varchar[],
      last_sign_in timestamptz
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("users", { ifExists: true, cascade: true });
  pgm.dropExtension("vector", { ifExists: true });
  pgm.dropExtension("uuid-ossp", { ifExists: true });
};