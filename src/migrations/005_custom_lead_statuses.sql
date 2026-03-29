-- 005: Custom Lead Statuses
-- Add category column to TrackerCustomStatuses, change Leads.status from ENUM to VARCHAR

-- 1. Add category column (existing rows default to 'CALLER')
ALTER TABLE TrackerCustomStatuses
  ADD COLUMN category ENUM('CALLER','LEAD') NOT NULL DEFAULT 'CALLER' AFTER trackerId;

-- 2. Update unique constraint to include category
ALTER TABLE TrackerCustomStatuses DROP INDEX unique_tracker_status;
ALTER TABLE TrackerCustomStatuses
  ADD UNIQUE KEY unique_tracker_category_status (trackerId, category, statusName);

-- 3. Change Leads.status from ENUM to VARCHAR so it can hold custom status names
ALTER TABLE Leads MODIFY COLUMN status VARCHAR(100) DEFAULT 'NEW';

-- 4. Seed default lead statuses for all existing trackers
INSERT IGNORE INTO TrackerCustomStatuses (trackerId, category, statusName, statusOrder, statusColor, statusType)
SELECT t.trackerId, 'LEAD', 'NEW', 1, 'blue', 'ACTIVE' FROM Trackers t
UNION ALL
SELECT t.trackerId, 'LEAD', 'CONTACTED', 2, 'yellow', 'ACTIVE' FROM Trackers t
UNION ALL
SELECT t.trackerId, 'LEAD', 'QUALIFIED', 3, 'purple', 'ACTIVE' FROM Trackers t
UNION ALL
SELECT t.trackerId, 'LEAD', 'CONVERTED', 4, 'green', 'SUCCESS' FROM Trackers t
UNION ALL
SELECT t.trackerId, 'LEAD', 'LOST', 5, 'red', 'FAILED' FROM Trackers t;
