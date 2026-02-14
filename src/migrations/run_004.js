const { getPool, closePool } = require('../config/database');

async function run() {
  const pool = await getPool();

  const stmts = [
    "ALTER TABLE Leads ADD COLUMN leadName VARCHAR(255) NULL AFTER serialNumber",
    "ALTER TABLE Leads ADD COLUMN leadEmail VARCHAR(255) NULL AFTER leadName",
    "ALTER TABLE Leads ADD COLUMN leadContact VARCHAR(50) NULL AFTER leadEmail",
    "ALTER TABLE Leads ADD COLUMN signupDate DATE NULL AFTER leadContact",
    "ALTER TABLE Leads ADD COLUMN assignedDate DATETIME NULL AFTER signupDate",
    "ALTER TABLE Leads ADD COLUMN sourceChannel ENUM('LinkedIn','Website','Referral','Cold Call','Event','Other') NULL AFTER assignedDate",
    "ALTER TABLE Leads ADD COLUMN sourceBdaId VARCHAR(36) NULL AFTER sourceChannel",
    "ALTER TABLE Leads ADD COLUMN isDuplicate BOOLEAN DEFAULT FALSE AFTER sourceBdaId",
    "ALTER TABLE Leads ADD COLUMN finalStatus VARCHAR(100) DEFAULT 'NEW' AFTER isDuplicate",
    "ALTER TABLE Leads ADD CONSTRAINT fk_leads_sourceBdaId FOREIGN KEY (sourceBdaId) REFERENCES Users(userId) ON DELETE SET NULL",
    "UPDATE Leads SET finalStatus = status WHERE finalStatus IS NULL",
    `CREATE TABLE IF NOT EXISTS CallerInteractions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      leadId VARCHAR(36) NOT NULL,
      trackerId VARCHAR(36) NOT NULL,
      callerId VARCHAR(36) NOT NULL,
      callerOrder INT NOT NULL DEFAULT 1,
      status VARCHAR(100) NULL,
      profileLinkGiven TEXT NULL,
      isProfileLocked BOOLEAN DEFAULT FALSE,
      connectRequestSent BOOLEAN DEFAULT FALSE,
      didUnfriend BOOLEAN DEFAULT FALSE,
      referenceName VARCHAR(255) NULL,
      callDate DATE NULL,
      finalCallDate DATE NULL,
      comments TEXT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (leadId) REFERENCES Leads(leadId) ON DELETE CASCADE,
      FOREIGN KEY (trackerId) REFERENCES Trackers(trackerId) ON DELETE CASCADE,
      FOREIGN KEY (callerId) REFERENCES Users(userId) ON DELETE CASCADE,
      INDEX idx_ci_lead (leadId, callerOrder),
      INDEX idx_ci_tracker (trackerId),
      INDEX idx_ci_caller (callerId)
    )`,
    `CREATE TABLE IF NOT EXISTS TrackerCustomStatuses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trackerId VARCHAR(36) NOT NULL,
      statusName VARCHAR(100) NOT NULL,
      statusOrder INT NOT NULL DEFAULT 0,
      statusColor VARCHAR(50) DEFAULT 'gray',
      statusType ENUM('ACTIVE','SUCCESS','FAILED','NEUTRAL') DEFAULT 'NEUTRAL',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (trackerId) REFERENCES Trackers(trackerId) ON DELETE CASCADE,
      UNIQUE KEY unique_tracker_status (trackerId, statusName),
      INDEX idx_tcs_order (trackerId, statusOrder)
    )`,
    `ALTER TABLE ActivityLog MODIFY COLUMN action ENUM('LEAD_ADDED','LEAD_EDITED','LEAD_DELETED','STATUS_CHANGED','LEAD_ASSIGNED','MEMBER_ADDED','MEMBER_REMOVED','CALLER_INTERACTION_ADDED','CALLER_INTERACTION_UPDATED','CUSTOM_STATUS_CREATED','CUSTOM_STATUS_UPDATED','DUPLICATE_DETECTED') NOT NULL`,
  ];

  for (const s of stmts) {
    try {
      await pool.query(s);
      console.log('OK:', s.substring(0, 70));
    } catch (e) {
      if (e.message.includes('Duplicate column') || e.message.includes('already exists')) {
        console.log('SKIP (exists):', s.substring(0, 70));
      } else {
        console.log('ERR:', e.message);
      }
    }
  }

  const [r] = await pool.query('DESCRIBE Leads');
  console.log('\nLeads columns:', r.map(c => c.Field).join(', '));

  const [t] = await pool.query('SHOW TABLES');
  console.log('Tables:', t.map(r => Object.values(r)[0]).join(', '));

  await closePool();
}

run();
