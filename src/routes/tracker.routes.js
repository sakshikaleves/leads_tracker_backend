const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, getTrackerMembership } = require('../middleware/permissions');

const router = express.Router();

// Validation
const validateTracker = [
  body('trackerName').notEmpty().trim().withMessage('Tracker name required'),
  body('businessName').notEmpty().trim().withMessage('Business name required'),
  body('trackerMode').isIn(['SINGULAR', 'MULTI']).withMessage('Mode must be SINGULAR or MULTI'),
];

// POST /api/trackers - Create tracker
router.post('/', authenticate, validateTracker, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { trackerName, businessName, trackerMode } = req.body;
    const userId = req.user.userId;
    const trackerId = uuidv4();
    const now = new Date();

    // Create tracker
    await query(
      `INSERT INTO Trackers (trackerId, trackerName, businessName, trackerMode, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [trackerId, trackerName, businessName, trackerMode, userId, now, now]
    );

    // Add creator as OWNER
    await query(
      `INSERT INTO TrackerMembers (trackerId, userId, role, canAddLeads, canEditLeads, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [trackerId, userId, 'OWNER', true, true, now]
    );

    res.status(201).json({
      success: true,
      message: 'Tracker created successfully',
      data: { trackerId, trackerName, businessName, trackerMode },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers - List my trackers
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await query(
      `SELECT t.trackerId, t.trackerName, t.businessName, t.trackerMode,
              t.createdAt, tm.role
       FROM Trackers t
       INNER JOIN TrackerMembers tm ON t.trackerId = tm.trackerId
       WHERE tm.userId = ?
       ORDER BY t.createdAt DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id - Get tracker details
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check membership
    const membership = await getTrackerMembership(userId, id);
    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this tracker',
      });
    }

    const result = await query(
      `SELECT t.*, u.email as creatorEmail
       FROM Trackers t
       INNER JOIN Users u ON t.createdBy = u.userId
       WHERE t.trackerId = ?`,
      [id]
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'Tracker not found' });
    }

    // Get members count
    const membersResult = await query(
      'SELECT COUNT(*) as memberCount FROM TrackerMembers WHERE trackerId = ?',
      [id]
    );

    // Get leads count
    const leadsResult = await query(
      'SELECT COUNT(*) as leadCount FROM Leads WHERE trackerId = ?',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...result[0],
        memberCount: membersResult[0].memberCount,
        leadCount: leadsResult[0].leadCount,
        myRole: membership.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/trackers/:id - Update tracker
router.put('/:id', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { trackerName, businessName, trackerMode } = req.body;
    const now = new Date();

    await query(
      `UPDATE Trackers
       SET trackerName = COALESCE(?, trackerName),
           businessName = COALESCE(?, businessName),
           trackerMode = COALESCE(?, trackerMode),
           updatedAt = ?
       WHERE trackerId = ?`,
      [trackerName, businessName, trackerMode, now, id]
    );

    res.json({
      success: true,
      message: 'Tracker updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/trackers/:id/duplicate - Duplicate tracker
router.post('/:id/duplicate', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newTrackerName } = req.body;
    const userId = req.user.userId;

    // Get original tracker
    const original = await query(
      'SELECT * FROM Trackers WHERE trackerId = ?',
      [id]
    );

    if (original.length === 0) {
      return res.status(404).json({ success: false, message: 'Tracker not found' });
    }

    const tracker = original[0];
    const newTrackerId = uuidv4();
    const now = new Date();

    // Create duplicate (without leads)
    await query(
      `INSERT INTO Trackers (trackerId, trackerName, businessName, trackerMode, createdBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newTrackerId, newTrackerName || `${tracker.trackerName} (Copy)`, tracker.businessName, tracker.trackerMode, userId, now, now]
    );

    // Add creator as OWNER
    await query(
      `INSERT INTO TrackerMembers (trackerId, userId, role, canAddLeads, canEditLeads, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newTrackerId, userId, 'OWNER', true, true, now]
    );

    res.status(201).json({
      success: true,
      message: 'Tracker duplicated successfully',
      data: { trackerId: newTrackerId },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/trackers/:id/request-access - Request access
router.post('/:id/request-access', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if tracker exists
    const tracker = await query('SELECT trackerId FROM Trackers WHERE trackerId = ?', [id]);
    if (tracker.length === 0) {
      return res.status(404).json({ success: false, message: 'Tracker not found' });
    }

    // Check if already a member
    const membership = await getTrackerMembership(userId, id);
    if (membership) {
      return res.status(400).json({ success: false, message: 'You are already a member' });
    }

    // Check for existing pending request
    const existing = await query(
      `SELECT id FROM AccessRequests WHERE trackerId = ? AND requesterId = ? AND status = 'PENDING'`,
      [id, userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'Request already pending' });
    }

    // Create request
    await query(
      `INSERT INTO AccessRequests (trackerId, requesterId, status, createdAt)
       VALUES (?, ?, 'PENDING', ?)`,
      [id, userId, new Date()]
    );

    res.status(201).json({
      success: true,
      message: 'Access request submitted',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/requests - List pending requests (admin only)
router.get('/:id/requests', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT ar.id, ar.status, ar.createdAt, u.userId, u.email, u.phoneNumber
       FROM AccessRequests ar
       INNER JOIN Users u ON ar.requesterId = u.userId
       WHERE ar.trackerId = ? AND ar.status = 'PENDING'
       ORDER BY ar.createdAt DESC`,
      [id]
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/requests/:requestId/respond - Accept/Reject request
router.put('/requests/:requestId/respond', authenticate, async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { action, role = 'MEMBER', canAddLeads = false, canEditLeads = false } = req.body;
    const userId = req.user.userId;

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or reject' });
    }

    // Get request details
    const request = await query(
      `SELECT ar.*, t.trackerId
       FROM AccessRequests ar
       INNER JOIN Trackers t ON ar.trackerId = t.trackerId
       WHERE ar.id = ? AND ar.status = 'PENDING'`,
      [requestId]
    );

    if (request.length === 0) {
      return res.status(404).json({ success: false, message: 'Request not found or already processed' });
    }

    const accessRequest = request[0];

    // Check if user is admin/owner of the tracker
    const membership = await getTrackerMembership(userId, accessRequest.trackerId);
    if (!membership || !['ADMIN', 'OWNER'].includes(membership.role)) {
      return res.status(403).json({ success: false, message: 'Only admin/owner can respond to requests' });
    }

    const now = new Date();
    const newStatus = action === 'accept' ? 'ACCEPTED' : 'REJECTED';

    // Update request status
    await query(
      `UPDATE AccessRequests SET status = ?, respondedAt = ? WHERE id = ?`,
      [newStatus, now, requestId]
    );

    // If accepted, add as member
    if (action === 'accept') {
      await query(
        `INSERT INTO TrackerMembers (trackerId, userId, role, canAddLeads, canEditLeads, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [accessRequest.trackerId, accessRequest.requesterId, role, canAddLeads, canEditLeads, now]
      );
    }

    res.json({
      success: true,
      message: `Request ${action}ed successfully`,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/members - List members
router.get('/:id/members', authenticate, requireRole('ADMIN', 'OWNER', 'MEMBER', 'VIEWER'), async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT tm.id, tm.role, tm.canAddLeads, tm.canEditLeads, tm.createdAt,
              u.userId, u.name, u.email, u.phoneNumber
       FROM TrackerMembers tm
       INNER JOIN Users u ON tm.userId = u.userId
       WHERE tm.trackerId = ?
       ORDER BY tm.createdAt`,
      [id]
    );

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/trackers/:id/invite - Admin invites BDA by email
router.post('/:id/invite', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;
    const { email, role } = req.body;
    const inviteRole = role || 'BDA';

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    // Check if already a member
    const existingMember = await query(
      `SELECT tm.id FROM TrackerMembers tm
       INNER JOIN Users u ON tm.userId = u.userId
       WHERE tm.trackerId = ? AND u.email = ?`,
      [trackerId, email]
    );

    if (existingMember.length > 0) {
      return res.status(409).json({ success: false, message: 'User is already a member of this tracker' });
    }

    // Check if invitation already exists
    const existingInvite = await query(
      `SELECT id FROM Invitations WHERE trackerId = ? AND email = ? AND status = 'PENDING'`,
      [trackerId, email]
    );

    if (existingInvite.length > 0) {
      return res.status(409).json({ success: false, message: 'Invitation already sent to this email' });
    }

    // Check if user already registered
    const existingUser = await query('SELECT userId FROM Users WHERE email = ?', [email]);

    if (existingUser.length > 0) {
      // User exists - add directly as member
      const now = new Date();
      await query(
        `INSERT INTO TrackerMembers (trackerId, userId, role, canAddLeads, canEditLeads, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [trackerId, existingUser[0].userId, inviteRole, inviteRole === 'BDA', inviteRole === 'BDA', now]
      );

      // Create invitation record as ACCEPTED
      await query(
        `INSERT INTO Invitations (trackerId, email, role, status, invitedBy, createdAt)
         VALUES (?, ?, ?, 'ACCEPTED', ?, ?)`,
        [trackerId, email, inviteRole, req.user.userId, now]
      );

      return res.status(201).json({
        success: true,
        message: 'User added to tracker directly (already registered)',
        data: { status: 'ACCEPTED' },
      });
    }

    // User not registered - create pending invitation
    const now = new Date();
    await query(
      `INSERT INTO Invitations (trackerId, email, role, status, invitedBy, createdAt)
       VALUES (?, ?, ?, 'PENDING', ?, ?)`,
      [trackerId, email, inviteRole, req.user.userId, now]
    );

    res.status(201).json({
      success: true,
      message: 'Invitation sent. User will be added when they register.',
      data: { status: 'PENDING' },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/invitations - List invitations
router.get('/:id/invitations', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;

    const result = await query(
      `SELECT i.id, i.email, i.role, i.status, i.createdAt, u.name as invitedByName
       FROM Invitations i
       INNER JOIN Users u ON i.invitedBy = u.userId
       WHERE i.trackerId = ?
       ORDER BY i.createdAt DESC`,
      [trackerId]
    );

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/trackers/:id/invite/:inviteId - Cancel invitation
router.delete('/:id/invite/:inviteId', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { inviteId } = req.params;

    const result = await query(
      `DELETE FROM Invitations WHERE id = ? AND status = 'PENDING'`,
      [inviteId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Invitation not found or already accepted' });
    }

    res.json({ success: true, message: 'Invitation cancelled' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
