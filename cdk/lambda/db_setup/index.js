const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { Client } = require('pg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const migrate = require('node-pg-migrate').default;

const sm = new SecretsManagerClient();

async function getSecret(name) {
  const data = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  return JSON.parse(data.SecretString);
}

async function putSecret(name, secret) {
  await sm.send(new PutSecretValueCommand({ SecretId: name, SecretString: JSON.stringify(secret) }));
}

async function runMigrations(db) {
  const dbUrl = `postgresql://${encodeURIComponent(db.username)}:${encodeURIComponent(db.password)}@${db.host}:${db.port || 5432}/${db.dbname}`;
  await migrate({
    databaseUrl: dbUrl,
    dir: path.join(__dirname, 'migrations'),
    direction: 'up',
    count: Infinity,
    migrationsTable: 'pgmigrations',
    logger: console,
    createSchema: false,
  });
}

async function ensureBaselineOrMigrate(db) {
  const client = new Client({
    user: db.username,
    password: db.password,
    host: db.host,
    database: db.dbname,
    port: db.port || 5432,
  });
  await client.connect();
  try {
    // Does migration tracking table exist?
    const migRes = await client.query(`SELECT to_regclass('public.pgmigrations') IS NOT NULL AS exists;`);
    const hasTracking = migRes.rows[0].exists;

    if (!hasTracking) {
      // Get all expected tables from migrations
      const expectedTables = ['users', 'simulation_groups', 'patients', 'enrolments', 'patient_data', 'student_interactions', 'sessions', 'messages', 'user_engagement_log', 'feedback'];
      
      // Check if any expected tables exist
      const existingTables = [];
      for (const table of expectedTables) {
        const result = await client.query(`SELECT to_regclass('public.${table}') IS NOT NULL AS exists;`);
        if (result.rows[0].exists) {
          existingTables.push(table);
        }
      }
      
      if (existingTables.length === expectedTables.length) {
        console.log(`[baseline] Found complete schema (${existingTables.length}/${expectedTables.length} tables). Creating migration baseline.`);
        await client.query(`CREATE TABLE IF NOT EXISTS pgmigrations (id serial PRIMARY KEY, name text UNIQUE NOT NULL, run_on timestamp NOT NULL DEFAULT now());`);
        const migrationsDir = path.join(__dirname, 'migrations');
        const files = fs.readdirSync(migrationsDir).filter(f => /\.(js|ts)$/.test(f)).sort();
        for (const f of files) {
          await client.query(`INSERT INTO pgmigrations (name) VALUES ($1) ON CONFLICT DO NOTHING;`, [f]);
        }
        console.log(`[baseline] Marked ${files.length} migrations as completed. Skipping migration run.`);
        return; // Skip running migrate this invocation
      } else if (existingTables.length > 0) {
        console.log(`[baseline] Partial schema detected (${existingTables.length}/${expectedTables.length} tables). Running migrations to complete schema.`);
      }
    }
  } finally {
    await client.end();
  }

  // Run migrations normally (fresh DB or tracking present)
  await runMigrations(db);
}

async function createAppUsers(adminDb, dbSecretName, userSecretName, proxySecretName) {
  const adminClient = new Client({
    user: adminDb.username,
    password: adminDb.password,
    host: adminDb.host,
    database: adminDb.dbname,
    port: adminDb.port || 5432,
  });
  await adminClient.connect();

  const rwUser = crypto.randomBytes(8).toString('hex');
  const rwPass = crypto.randomBytes(16).toString('hex');
  const tcUser = crypto.randomBytes(8).toString('hex');
  const tcPass = crypto.randomBytes(16).toString('hex');

  const createRolesSQL = `
    DO $$
    BEGIN
        CREATE ROLE readwrite;
    EXCEPTION
        WHEN duplicate_object THEN
            RAISE NOTICE 'Role already exists.';
    END
    $$;

    GRANT CONNECT ON DATABASE postgres TO readwrite;

    GRANT USAGE ON SCHEMA public TO readwrite;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO readwrite;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO readwrite;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO readwrite;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO readwrite;

    CREATE USER "${rwUser}" WITH PASSWORD '${rwPass}';
    GRANT readwrite TO "${rwUser}";`;

  const createTableCreatorSQL = `
    DO $$
    BEGIN
        CREATE ROLE tablecreator;
    EXCEPTION
        WHEN duplicate_object THEN
            RAISE NOTICE 'Role already exists.';
    END
    $$;

    GRANT CONNECT ON DATABASE postgres TO tablecreator;

    GRANT USAGE, CREATE ON SCHEMA public TO tablecreator;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tablecreator;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tablecreator;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO tablecreator;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO tablecreator;

    CREATE USER "${tcUser}" WITH PASSWORD '${tcPass}';
    GRANT tablecreator TO "${tcUser}";`;

  await adminClient.query('BEGIN');
  try {
    await adminClient.query(createRolesSQL);
    await adminClient.query(createTableCreatorSQL);
    await adminClient.query('COMMIT');
  } catch (e) {
    await adminClient.query('ROLLBACK');
    throw e;
  } finally {
    await adminClient.end();
  }

  // Update secrets
  const adminSecret = await getSecret(dbSecretName);

  const proxySecret = { ...adminSecret, username: tcUser, password: tcPass };
  await putSecret(proxySecretName, proxySecret);

  const userSecret = { ...adminSecret, username: rwUser, password: rwPass };
  await putSecret(userSecretName, userSecret);
}

exports.handler = async function() {
  const { DB_SECRET_NAME, DB_USER_SECRET_NAME, DB_PROXY } = process.env;
  const adminDb = await getSecret(DB_SECRET_NAME);
  await ensureBaselineOrMigrate(adminDb);
  await createAppUsers(adminDb, DB_SECRET_NAME, DB_USER_SECRET_NAME, DB_PROXY);
  return { status: 'ok' };
};
