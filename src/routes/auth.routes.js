const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { hashPassword, comparePassword, generateToken } = require('../services/auth.service');
const { sendPasswordResetEmail } = require('../services/email.service');
const { authenticate } = require('../middleware/auth');
const config = require('../config/env');

const router = express.Router();

// Validation middleware
const validateRegister = [
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phoneNumber').optional().isMobilePhone().withMessage('Invalid phone number'),
];

const validateLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
];

// POST /api/auth/register
router.post('/register', validateRegister, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { name, email, password, phoneNumber } = req.body;

    // Check if user exists
    const existingUser = await query(
      'SELECT userId FROM Users WHERE email = ?',
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered',
      });
    }

    // Invite-only check: must have a pending OrgInvitation or tracker Invitation, or be a super admin
    const isSuperAdmin = config.superAdminEmails.includes(email);
    const orgInvites = await query(
      `SELECT id FROM OrgInvitations WHERE email = ? AND status = 'PENDING'`,
      [email]
    );
    const trackerInvites = await query(
      `SELECT id FROM Invitations WHERE email = ? AND status = 'PENDING'`,
      [email]
    );

    if (!isSuperAdmin && orgInvites.length === 0 && trackerInvites.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Registration is invite-only. Please contact your admin or reach out at hitesh@tresto.io',
      });
    }

    // Create user
    const userId = uuidv4();
    const passwordHash = await hashPassword(password);
    const now = new Date();

    await query(
      `INSERT INTO Users (userId, name, email, passwordHash, phoneNumber, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, email, passwordHash, phoneNumber || null, now, now]
    );

    // Auto-accept pending tracker invitations for this email
    const pendingInvites = await query(
      `SELECT id, trackerId, role FROM Invitations WHERE email = ? AND status = 'PENDING'`,
      [email]
    );

    for (const invite of pendingInvites) {
      await query(
        `INSERT INTO TrackerMembers (trackerId, userId, role, canAddLeads, canEditLeads, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invite.trackerId, userId, invite.role, invite.role === 'BDA', invite.role === 'BDA', now]
      );
      await query(
        `UPDATE Invitations SET status = 'ACCEPTED' WHERE id = ?`,
        [invite.id]
      );
    }

    // Auto-accept pending org invitations for this email
    const pendingOrgInvites = await query(
      `SELECT id, orgId, role, invitedBy FROM OrgInvitations WHERE email = ? AND status = 'PENDING'`,
      [email]
    );

    for (const invite of pendingOrgInvites) {
      await query(
        `INSERT INTO OrgMembers (orgId, userId, role, addedBy, createdAt) VALUES (?, ?, ?, ?, ?)`,
        [invite.orgId, userId, invite.role, invite.invitedBy, now]
      );
      await query(
        `UPDATE OrgInvitations SET status = 'ACCEPTED' WHERE id = ?`,
        [invite.id]
      );
    }

    // Generate token
    const token = generateToken({ userId, email });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        userId,
        name,
        email,
        phoneNumber: phoneNumber || null,
        token,
        autoJoinedTrackers: pendingInvites.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post('/login', validateLogin, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    // Find user
    const result = await query(
      'SELECT userId, name, email, passwordHash, phoneNumber FROM Users WHERE email = ?',
      [email]
    );

    if (result.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    const user = result[0];

    // Verify password
    const isValidPassword = await comparePassword(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Generate token
    const token = generateToken({ userId: user.userId, email: user.email });

    // Get user's org memberships
    const orgs = await query(
      `SELECT om.orgId, o.orgName, om.role as orgRole
       FROM OrgMembers om
       INNER JOIN Organizations o ON om.orgId = o.orgId
       WHERE om.userId = ?`,
      [user.userId]
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        isSuperAdmin: config.superAdminEmails.includes(user.email),
        orgs,
        token,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT userId, name, email, phoneNumber, createdAt FROM Users WHERE userId = ?',
      [req.user.userId]
    );

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get user's org memberships
    const orgs = await query(
      `SELECT om.orgId, o.orgName, om.role as orgRole
       FROM OrgMembers om
       INNER JOIN Organizations o ON om.orgId = o.orgId
       WHERE om.userId = ?`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: {
        ...result[0],
        isSuperAdmin: config.superAdminEmails.includes(result[0].email),
        orgs,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/auth/profile - Update name/phone
router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { name, phoneNumber } = req.body;
    const now = new Date();

    await query(
      `UPDATE Users SET name = COALESCE(?, name), phoneNumber = COALESCE(?, phoneNumber), updatedAt = ? WHERE userId = ?`,
      [name, phoneNumber, now, req.user.userId]
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email } = req.body;

    // Always return success to prevent email enumeration
    const user = await query('SELECT userId FROM Users WHERE email = ?', [email]);
    if (user.length === 0) {
      return res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing unused tokens for this user
    await query('UPDATE PasswordResets SET usedAt = NOW() WHERE userId = ? AND usedAt IS NULL', [user[0].userId]);

    // Store new token
    await query(
      'INSERT INTO PasswordResets (userId, token, expiresAt) VALUES (?, ?, ?)',
      [user[0].userId, token, expiresAt]
    );

    // Send email
    await sendPasswordResetEmail(email, token);

    res.json({ success: true, message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { token, password } = req.body;

    // Find valid token
    const resetRecord = await query(
      'SELECT id, userId, expiresAt FROM PasswordResets WHERE token = ? AND usedAt IS NULL',
      [token]
    );

    if (resetRecord.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset link.' });
    }

    const record = resetRecord[0];

    // Check expiry
    if (new Date(record.expiresAt) < new Date()) {
      return res.status(400).json({ success: false, message: 'Reset link has expired. Please request a new one.' });
    }

    // Update password
    const passwordHash = await hashPassword(password);
    await query('UPDATE Users SET passwordHash = ?, updatedAt = NOW() WHERE userId = ?', [passwordHash, record.userId]);

    // Mark token as used
    await query('UPDATE PasswordResets SET usedAt = NOW() WHERE id = ?', [record.id]);

    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
