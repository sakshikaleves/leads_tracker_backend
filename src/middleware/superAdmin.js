const config = require('../config/env');

function requireSuperAdmin(req, res, next) {
  if (!config.superAdminEmails.includes(req.user.email)) {
    return res.status(403).json({ success: false, message: 'Super admin access required' });
  }
  next();
}

module.exports = { requireSuperAdmin };
