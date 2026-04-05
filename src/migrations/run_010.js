require('dotenv').config();
const { query, getPool } = require('../config/database');

async function run() {
  try {
    await getPool();
    console.log('Running migration 010: Password resets...');

    await query(`
      CREATE TABLE IF NOT EXISTS PasswordResets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId VARCHAR(36) NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expiresAt DATETIME NOT NULL,
        usedAt DATETIME NULL DEFAULT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_resets_token (token),
        INDEX idx_password_resets_user (userId)
      )
    `);

    console.log('Migration 010 complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
