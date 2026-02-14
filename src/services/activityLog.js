const { query } = require('../config/database');

async function logActivity(trackerId, userId, action, leadId = null, details = null) {
  await query(
    `INSERT INTO ActivityLog (trackerId, leadId, userId, action, details, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [trackerId, leadId, userId, action, details ? JSON.stringify(details) : null, new Date()]
  );
}

module.exports = { logActivity };
