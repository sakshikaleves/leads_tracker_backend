-- Organizations table
CREATE TABLE IF NOT EXISTS Organizations (
  orgId VARCHAR(36) NOT NULL,
  orgName VARCHAR(255) NOT NULL,
  createdBy VARCHAR(36) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (orgId),
  FOREIGN KEY (createdBy) REFERENCES Users(userId) ON DELETE RESTRICT
);

-- OrgMembers table
CREATE TABLE IF NOT EXISTS OrgMembers (
  id INT NOT NULL AUTO_INCREMENT,
  orgId VARCHAR(36) NOT NULL,
  userId VARCHAR(36) NOT NULL,
  role ENUM('ORG_ADMIN', 'ORG_MEMBER') NOT NULL DEFAULT 'ORG_MEMBER',
  addedBy VARCHAR(36) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_user (orgId, userId),
  FOREIGN KEY (orgId) REFERENCES Organizations(orgId) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES Users(userId) ON DELETE CASCADE,
  FOREIGN KEY (addedBy) REFERENCES Users(userId) ON DELETE RESTRICT
);

-- Add orgId column to Trackers
ALTER TABLE Trackers ADD COLUMN orgId VARCHAR(36) NULL;

-- Add FK for orgId on Trackers
ALTER TABLE Trackers ADD CONSTRAINT fk_trackers_orgId FOREIGN KEY (orgId) REFERENCES Organizations(orgId) ON DELETE SET NULL;

-- Seed default Tresto organization (only runs if users exist)
INSERT IGNORE INTO Organizations (orgId, orgName, createdBy, createdAt, updatedAt)
SELECT '00000000-0000-0000-0000-000000000001', 'Tresto',
  COALESCE(
    (SELECT userId FROM Users WHERE email = 'hitesh@tresto.io' LIMIT 1),
    (SELECT userId FROM Users ORDER BY createdAt ASC LIMIT 1)
  ),
  NOW(), NOW()
FROM Users LIMIT 1;

-- Assign all existing trackers to the default org
UPDATE Trackers SET orgId = '00000000-0000-0000-0000-000000000001' WHERE orgId IS NULL;

-- Add all tracker member users as org members
INSERT IGNORE INTO OrgMembers (orgId, userId, role, addedBy, createdAt)
SELECT DISTINCT
  '00000000-0000-0000-0000-000000000001',
  tm.userId,
  'ORG_MEMBER',
  COALESCE(
    (SELECT userId FROM Users WHERE email = 'hitesh@tresto.io' LIMIT 1),
    (SELECT userId FROM Users ORDER BY createdAt ASC LIMIT 1)
  ),
  NOW()
FROM TrackerMembers tm;

-- Promote OWNER/ADMIN tracker members to ORG_ADMIN
UPDATE OrgMembers
SET role = 'ORG_ADMIN'
WHERE orgId = '00000000-0000-0000-0000-000000000001'
  AND userId IN (
    SELECT DISTINCT userId FROM TrackerMembers WHERE role IN ('OWNER', 'ADMIN')
  )
