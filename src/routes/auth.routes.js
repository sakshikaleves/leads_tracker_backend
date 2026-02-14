const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { hashPassword, comparePassword, generateToken } = require('../services/auth.service');
const { authenticate } = require('../middleware/auth');

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

    // Create user
    const userId = uuidv4();
    const passwordHash = await hashPassword(password);
    const now = new Date();

    await query(
      `INSERT INTO Users (userId, name, email, passwordHash, phoneNumber, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, email, passwordHash, phoneNumber || null, now, now]
    );

    // Auto-accept pending invitations for this email
    const pendingInvites = await query(
      `SELECT id, trackerId, role FROM Invitations WHERE email = ? AND status = 'PENDING'`,
      [email]
    );

    for (const invite of pendingInvites) {
      // Add user as member of the tracker
      await query(
        `INSERT INTO TrackerMembers (trackerId, userId, role, canAddLeads, canEditLeads, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [invite.trackerId, userId, invite.role, invite.role === 'BDA', invite.role === 'BDA', now]
      );

      // Mark invitation as accepted
      await query(
        `UPDATE Invitations SET status = 'ACCEPTED' WHERE id = ?`,
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

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
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

    res.json({
      success: true,
      data: result[0],
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

module.exports = router;
