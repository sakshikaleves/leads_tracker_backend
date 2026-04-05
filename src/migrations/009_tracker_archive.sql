-- Add soft-delete columns to Trackers
ALTER TABLE Trackers
  ADD COLUMN archivedAt DATETIME NULL DEFAULT NULL,
  ADD COLUMN archivedBy VARCHAR(36) NULL DEFAULT NULL;

-- Index for querying non-archived trackers
CREATE INDEX idx_trackers_archived ON Trackers (archivedAt);
