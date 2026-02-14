-- 003: Team features - Lead status workflow, assignment, activity log

-- Add status and assignedTo to Leads
ALTER TABLE Leads ADD COLUMN status ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST') DEFAULT 'NEW' AFTER leadType;
ALTER TABLE Leads ADD COLUMN assignedTo VARCHAR(36) NULL AFTER leadOwnerId;
ALTER TABLE Leads ADD CONSTRAINT fk_leads_assignedTo FOREIGN KEY (assignedTo) REFERENCES Users(userId) ON DELETE SET NULL;

-- Activity Log table
CREATE TABLE IF NOT EXISTS ActivityLog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  trackerId VARCHAR(36) NOT NULL,
  leadId VARCHAR(36) NULL,
  userId VARCHAR(36) NOT NULL,
  action ENUM('LEAD_ADDED', 'LEAD_EDITED', 'LEAD_DELETED', 'STATUS_CHANGED', 'LEAD_ASSIGNED', 'MEMBER_ADDED', 'MEMBER_REMOVED') NOT NULL,
  details JSON NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trackerId) REFERENCES Trackers(trackerId) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES Users(userId),
  INDEX idx_tracker_created (trackerId, createdAt DESC),
  INDEX idx_lead (leadId)
);
