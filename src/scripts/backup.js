/**
 * Database Backup Script
 *
 * Exports all data from the MySQL database to a JSON file.
 * Run: node src/scripts/backup.js
 *
 * For production, also set up:
 * 1. Hostinger automatic backups (available in your hosting panel)
 * 2. Schedule this script via cron/task scheduler for local JSON backups
 */

const { query, closePool } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function backup() {
  try {
    console.log('Starting database backup...');

    const users = await query('SELECT userId, name, email, phoneNumber, createdAt FROM Users');
    const trackers = await query('SELECT * FROM Trackers');
    const trackerMembers = await query('SELECT * FROM TrackerMembers');
    const leads = await query('SELECT * FROM Leads');
    const invitations = await query('SELECT * FROM Invitations');
    const accessRequests = await query('SELECT * FROM AccessRequests');

    const backupData = {
      backupDate: new Date().toISOString(),
      tables: {
        users: { count: users.length, data: users },
        trackers: { count: trackers.length, data: trackers },
        trackerMembers: { count: trackerMembers.length, data: trackerMembers },
        leads: { count: leads.length, data: leads },
        invitations: { count: invitations.length, data: invitations },
        accessRequests: { count: accessRequests.length, data: accessRequests },
      },
    };

    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.json`;
    const filepath = path.join(backupDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));

    console.log(`Backup complete: ${filepath}`);
    console.log(`  Users: ${users.length}`);
    console.log(`  Trackers: ${trackers.length}`);
    console.log(`  Members: ${trackerMembers.length}`);
    console.log(`  Leads: ${leads.length}`);
    console.log(`  Invitations: ${invitations.length}`);

    await closePool();
  } catch (error) {
    console.error('Backup failed:', error.message);
    process.exit(1);
  }
}

backup();
