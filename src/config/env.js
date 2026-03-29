require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'lead_tracker',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    port: parseInt(process.env.DB_PORT) || 3306,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'default_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  superAdminEmails: process.env.SUPER_ADMIN_EMAILS
    ? process.env.SUPER_ADMIN_EMAILS.split(',').map((e) => e.trim())
    : [],

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@tresto.io',
  },

  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
};
