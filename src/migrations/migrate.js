const fs = require('fs');
const path = require('path');
const { getPool, closePool } = require('../config/database');

async function runMigrationFile(pool, filename) {
  console.log(`\nRunning migration: ${filename}`);
  const migrationFile = path.join(__dirname, filename);
  const sql = fs.readFileSync(migrationFile, 'utf8');

  const statements = sql.split(';').filter((stmt) => stmt.trim());

  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await pool.query(statement);
        console.log('Executed:', statement.substring(0, 50) + '...');
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('Duplicate')) {
          console.error('Statement error:', err.message);
        }
      }
    }
  }
}

async function runMigrations() {
  console.log('Starting database migrations...');

  try {
    const pool = await getPool();

    await runMigrationFile(pool, '001_initial_schema.sql');
    await runMigrationFile(pool, '002_org_bda_restructure.sql');
    await runMigrationFile(pool, '003_team_features.sql');
    await runMigrationFile(pool, '004_crm_enhancements.sql');
    await runMigrationFile(pool, '005_custom_lead_statuses.sql');
    await runMigrationFile(pool, '007_organizations.sql');
    await runMigrationFile(pool, '008_org_invitations.sql');

    console.log('\nAll migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

runMigrations();
