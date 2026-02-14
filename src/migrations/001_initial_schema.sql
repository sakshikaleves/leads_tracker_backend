-- Lead Tracker Database Schema for MySQL

-- Users Table
CREATE TABLE IF NOT EXISTS Users (
    userId VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    passwordHash VARCHAR(255) NOT NULL,
    phoneNumber VARCHAR(20) NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Trackers Table
CREATE TABLE IF NOT EXISTS Trackers (
    trackerId VARCHAR(36) PRIMARY KEY,
    trackerName VARCHAR(255) NOT NULL,
    businessName VARCHAR(255) NOT NULL,
    trackerMode ENUM('SINGULAR', 'MULTI') NOT NULL,
    createdBy VARCHAR(36) NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (createdBy) REFERENCES Users(userId)
);

-- Tracker Members Table
CREATE TABLE IF NOT EXISTS TrackerMembers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trackerId VARCHAR(36) NOT NULL,
    userId VARCHAR(36) NOT NULL,
    role ENUM('ADMIN', 'OWNER', 'MEMBER', 'VIEWER') NOT NULL,
    canAddLeads BOOLEAN DEFAULT FALSE,
    canEditLeads BOOLEAN DEFAULT FALSE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trackerId) REFERENCES Trackers(trackerId) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES Users(userId),
    UNIQUE KEY unique_tracker_user (trackerId, userId)
);

-- Access Requests Table
CREATE TABLE IF NOT EXISTS AccessRequests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trackerId VARCHAR(36) NOT NULL,
    requesterId VARCHAR(36) NOT NULL,
    status ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    respondedAt DATETIME NULL,
    FOREIGN KEY (trackerId) REFERENCES Trackers(trackerId) ON DELETE CASCADE,
    FOREIGN KEY (requesterId) REFERENCES Users(userId),
    UNIQUE KEY unique_tracker_requester (trackerId, requesterId)
);

-- Leads Table
CREATE TABLE IF NOT EXISTS Leads (
    leadId VARCHAR(36) PRIMARY KEY,
    trackerId VARCHAR(36) NOT NULL,
    leadOwnerId VARCHAR(36) NOT NULL,
    leadOwnerPhone VARCHAR(20) NULL,
    leadType ENUM('NEW', 'YELLOW') NOT NULL,
    country VARCHAR(100) NOT NULL,
    city VARCHAR(100) NULL,
    leadWants VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    notesForTeam TEXT NULL,
    additionalDetails TEXT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    monthAdded INT NOT NULL,
    yearAdded INT NOT NULL,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (trackerId) REFERENCES Trackers(trackerId) ON DELETE CASCADE,
    FOREIGN KEY (leadOwnerId) REFERENCES Users(userId)
);

-- Create indexes
CREATE INDEX IX_Leads_TrackerId ON Leads(trackerId);
CREATE INDEX IX_Leads_LeadOwnerId ON Leads(leadOwnerId);
CREATE INDEX IX_Leads_LeadType ON Leads(leadType);
CREATE INDEX IX_Leads_MonthYear ON Leads(monthAdded, yearAdded);
CREATE INDEX IX_TrackerMembers_UserId ON TrackerMembers(userId);
CREATE INDEX IX_AccessRequests_Status ON AccessRequests(status);
