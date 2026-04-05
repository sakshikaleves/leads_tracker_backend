-- Password reset tokens
CREATE TABLE IF NOT EXISTS PasswordResets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId VARCHAR(36) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expiresAt DATETIME NOT NULL,
  usedAt DATETIME NULL DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_password_resets_token (token),
  INDEX idx_password_resets_user (userId)
);
