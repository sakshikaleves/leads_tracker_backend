-- Add name field to Users
ALTER TABLE Users ADD COLUMN name VARCHAR(100) NULL;

-- Create Invitations table
CREATE TABLE IF NOT EXISTS Invitations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trackerId VARCHAR(36) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role ENUM('ADMIN', 'BDA', 'VIEWER') DEFAULT 'BDA',
    status ENUM('PENDING', 'ACCEPTED') DEFAULT 'PENDING',
    invitedBy VARCHAR(36) NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trackerId) REFERENCES Trackers(trackerId) ON DELETE CASCADE,
    FOREIGN KEY (invitedBy) REFERENCES Users(userId),
    UNIQUE KEY unique_tracker_email (trackerId, email)
);

-- Update TrackerMembers role to include BDA
ALTER TABLE TrackerMembers MODIFY COLUMN role ENUM('ADMIN', 'OWNER', 'BDA', 'MEMBER', 'VIEWER') NOT NULL;

-- Index for invitation lookup on registration
CREATE INDEX IX_Invitations_Email ON Invitations(email);
CREATE INDEX IX_Invitations_Status ON Invitations(status);
