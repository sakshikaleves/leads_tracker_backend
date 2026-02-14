/**
 * Database Restore Script
 *
 * Restores data from a backup JSON file.
 * Run: node src/scripts/restore.js <backup-file-path>
 *
 * WARNING: This will INSERT data into existing tables.
 * Make sure the tables are empty or handle duplicates.
 */

const { query, closePool } = require('../config/database');
const fs = require('fs');

async function restore() {
  const backupFile = process.argv[2];
  if (!backupFile) {
    console.error('Usage: node src/scripts/restore.js <backup-file.json>');
    process.exit(1);
  }

  if (!fs.existsSync(backupFile)) {
    console.error(`File not found: ${backupFile}`);
    process.exit(1);
  }

  try {
    console.log(`Restoring from: ${backupFile}`);
    const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
    console.log(`Backup date: ${backupData.backupDate}`);

    const { tables } = backupData;

    // Restore in order (respecting foreign keys)
    // 1. Users
    for (const user of tables.users.data) {
      await query(
        `INSERT IGNORE INTO Users (userId, name, email, phoneNumber, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
        [user.userId, user.name, user.email, user.phoneNumber, user.createdAt]
      );
    }
    console.log(`  Users restored: ${tables.users.count}`);

    // 2. Trackers
    for (const t of tables.trackers.data) {
      await query(
        `INSERT IGNORE INTO Trackers (trackerId, trackerName, businessName, trackerMode, createdBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [t.trackerId, t.trackerName, t.businessName, t.trackerMode, t.createdBy, t.createdAt, t.updatedAt]
      );
    }
    console.log(`  Trackers restored: ${tables.trackers.count}`);

    // 3. TrackerMembers
    for (const m of tables.trackerMembers.data) {
      await query(
        `INSERT IGNORE INTO TrackerMembers (id, trackerId, userId, role, canAddLeads, canEditLeads, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.id, m.trackerId, m.userId, m.role, m.canAddLeads, m.canEditLeads, m.createdAt]
      );
    }
    console.log(`  Members restored: ${tables.trackerMembers.count}`);

    // 4. Leads
    for (const l of tables.leads.data) {
      await query(
        `INSERT IGNORE INTO Leads (leadId, trackerId, leadOwnerId, leadOwnerPhone, leadType, country, city, leadWants, description, notesForTeam, additionalDetails, monthAdded, yearAdded, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [l.leadId, l.trackerId, l.leadOwnerId, l.leadOwnerPhone, l.leadType, l.country, l.city, l.leadWants, l.description, l.notesForTeam, l.additionalDetails, l.monthAdded, l.yearAdded, l.createdAt, l.updatedAt]
      );
    }
    console.log(`  Leads restored: ${tables.leads.count}`);

    // 5. Invitations
    for (const i of tables.invitations.data) {
      await query(
        `INSERT IGNORE INTO Invitations (id, trackerId, email, role, status, invitedBy, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [i.id, i.trackerId, i.email, i.role, i.status, i.invitedBy, i.createdAt]
      );
    }
    console.log(`  Invitations restored: ${tables.invitations.count}`);

    console.log('Restore complete!');
    await closePool();
  } catch (error) {
    console.error('Restore failed:', error.message);
    process.exit(1);
  }
}

restore();
