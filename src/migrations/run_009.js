require('dotenv').config();
const { query, getPool } = require('../config/database');

async function run() {
  try {
    await getPool();
    console.log('Running migration 009: Tracker archive...');

    await query(`ALTER TABLE Trackers ADD COLUMN archivedAt DATETIME NULL DEFAULT NULL`);
    await query(`ALTER TABLE Trackers ADD COLUMN archivedBy VARCHAR(36) NULL DEFAULT NULL`);
    await query(`CREATE INDEX idx_trackers_archived ON Trackers (archivedAt)`);

    console.log('Migration 009 complete.');
    process.exit(0);
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Columns already exist, skipping.');
      process.exit(0);
    }
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
