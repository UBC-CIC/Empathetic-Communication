const {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { Client } = require("pg");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const migrate = require("node-pg-migrate").default;

const sm = new SecretsManagerClient();

async function getSecret(name) {
  const data = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  return JSON.parse(data.SecretString);
}

async function putSecret(name, secret) {
  await sm.send(
    new PutSecretValueCommand({
      SecretId: name,
      SecretString: JSON.stringify(secret),
    })
  );
}

async function fixMigrationTracking(db) {
  const client = new Client({
    user: db.username,
    password: db.password,
    host: db.host,
    database: db.dbname,
    port: db.port || 5432,
  });
  await client.connect();

  // Create pgmigrations table if it doesn't exist
  await client.query(`
    CREATE TABLE IF NOT EXISTS pgmigrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      run_on TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Check if key tables exist to determine if migrations have run
  const tablesExist = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name IN ('users', 'simulation_groups', 'patients', 'messages')
  `);

  // If core tables exist, mark basic migrations as complete
  if (tablesExist.rows.length >= 4) {
    console.log('Core tables exist, marking basic migrations as complete');
    const basicMigrations = [
      '1704110400000_create_extensions_and_users',
      '1704110460000_create_simulation_groups', 
      '1704110520000_create_patients',
      '1704110580000_create_enrolments',
      '1704110640000_create_patient_data',
      '1704110700000_create_student_interactions',
      '1704110760000_create_sessions',
      '1704110820000_create_messages',
      '1704110880000_create_user_engagement_log',
      '1704110940000_create_feedback',
      '1704111000000_create_system_prompt_history',
      '1704111060000_add_vector_extension',
      '1704111120000_add_voice_toggles'
    ];
    
    for (const migration of basicMigrations) {
      // Check if migration already exists before inserting
      const exists = await client.query(`
        SELECT 1 FROM pgmigrations WHERE name = $1
      `, [migration]);
      
      if (exists.rows.length === 0) {
        await client.query(`
          INSERT INTO pgmigrations (name, run_on) VALUES ($1, NOW())
        `, [migration]);
      }
    }
  }

  await client.end();
}

async function runMigrations(db) {
  const dbUrl = `postgresql://${encodeURIComponent(
    db.username
  )}:${encodeURIComponent(db.password)}@${db.host}:${db.port || 5432}/${
    db.dbname
  }`;
  await migrate({
    databaseUrl: dbUrl,
    dir: path.join(__dirname, "migrations"),
    direction: "up",
    count: Infinity,
    migrationsTable: "pgmigrations",
    logger: console,
    createSchema: false,
  });
}

async function ensureBaselineOrMigrate(db) {
  await runMigrations(db);
}

async function createAppUsers(
  adminDb,
  dbSecretName,
  userSecretName,
  proxySecretName
) {
  const adminClient = new Client({
    user: adminDb.username,
    password: adminDb.password,
    host: adminDb.host,
    database: adminDb.dbname, // target DB
    port: adminDb.port || 5432,
    ssl: adminDb.ssl || undefined, // set true or config if needed
  });
  await adminClient.connect();

  // Stable usernames; rotate passwords idempotently
  const RW_NAME = "app_rw";
  const TC_NAME = "app_tc";
  const rwPass = crypto.randomBytes(16).toString("hex");
  const tcPass = crypto.randomBytes(16).toString("hex");

  // Safe quoting for DB identifier inside SQL
  const dbIdent = adminDb.dbname.replace(/"/g, '""');

  const sql = `
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readwrite') THEN
        CREATE ROLE readwrite;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tablecreator') THEN
        CREATE ROLE tablecreator;
      END IF;
    END$$;

    GRANT CONNECT ON DATABASE "${dbIdent}" TO readwrite;
    GRANT CONNECT ON DATABASE "${dbIdent}" TO tablecreator;

    GRANT USAGE ON SCHEMA public TO readwrite;
    GRANT USAGE ON SCHEMA public TO tablecreator;
    GRANT CREATE ON SCHEMA public TO tablecreator;

    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO readwrite;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tablecreator;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO readwrite;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tablecreator;

    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO readwrite;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO tablecreator;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO readwrite;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO tablecreator;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RW_NAME}') THEN
        EXECUTE format('CREATE USER ${RW_NAME} WITH PASSWORD %L', '${rwPass}');
      ELSE
        EXECUTE format('ALTER USER ${RW_NAME} WITH PASSWORD %L', '${rwPass}');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TC_NAME}') THEN
        EXECUTE format('CREATE USER ${TC_NAME} WITH PASSWORD %L', '${tcPass}');
      ELSE
        EXECUTE format('ALTER USER ${TC_NAME} WITH PASSWORD %L', '${tcPass}');
      END IF;
    END$$;

    GRANT readwrite TO ${RW_NAME};
    GRANT tablecreator TO ${TC_NAME};
  `;

  await adminClient.query("BEGIN");
  try {
    await adminClient.query(sql);
    await adminClient.query("COMMIT");
  } catch (e) {
    await adminClient.query("ROLLBACK");
    throw e;
  } finally {
    await adminClient.end();
  }

  // Update Secrets Manager with the rotated creds
  const base = await getSecret(dbSecretName);
  await putSecret(proxySecretName, {
    ...base,
    username: TC_NAME,
    password: tcPass,
  });
  await putSecret(userSecretName, {
    ...base,
    username: RW_NAME,
    password: rwPass,
  });
}

exports.handler = async function () {
  const { DB_SECRET_NAME, DB_USER_SECRET_NAME, DB_PROXY } = process.env;
  const adminDb = await getSecret(DB_SECRET_NAME);
  
  // Fix migration tracking first
  await fixMigrationTracking(adminDb);
  
  // Then run any new migrations
  await ensureBaselineOrMigrate(adminDb);
  
  await createAppUsers(adminDb, DB_SECRET_NAME, DB_USER_SECRET_NAME, DB_PROXY);
  return { status: "ok" };
};