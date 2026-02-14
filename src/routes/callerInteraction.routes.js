const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

// GET /api/trackers/:id/leads/:leadId/caller-interactions
router.get('/:id/leads/:leadId/caller-interactions', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER', 'VIEWER'), async (req, res, next) => {
  try {
    const { leadId } = req.params;
    const result = await query(
      `SELECT ci.*, u.name as callerName, u.email as callerEmail
       FROM CallerInteractions ci
       INNER JOIN Users u ON ci.callerId = u.userId
       WHERE ci.leadId = ?
       ORDER BY ci.callerOrder ASC`,
      [leadId]
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/trackers/:id/leads/:leadId/caller-interactions
router.post('/:id/leads/:leadId/caller-interactions', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER'), async (req, res, next) => {
  try {
    const { id: trackerId, leadId } = req.params;
    const {
      callerId,
      status,
      profileLinkGiven,
      isProfileLocked,
      connectRequestSent,
      didUnfriend,
      referenceName,
      callDate,
      finalCallDate,
      comments,
    } = req.body;

    const callerUserId = callerId || req.user.userId;

    // Verify caller is a tracker member
    const member = await query(
      'SELECT id FROM TrackerMembers WHERE trackerId = ? AND userId = ?',
      [trackerId, callerUserId]
    );
    if (member.length === 0) {
      return res.status(400).json({ success: false, message: 'Caller is not a member of this tracker' });
    }

    // Get next caller order
    const maxOrder = await query(
      'SELECT MAX(callerOrder) as maxOrder FROM CallerInteractions WHERE leadId = ?',
      [leadId]
    );
    const callerOrder = (maxOrder[0]?.maxOrder || 0) + 1;

    const result = await query(
      `INSERT INTO CallerInteractions
        (leadId, trackerId, callerId, callerOrder, status, profileLinkGiven,
         isProfileLocked, connectRequestSent, didUnfriend, referenceName,
         callDate, finalCallDate, comments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leadId, trackerId, callerUserId, callerOrder,
        status || null, profileLinkGiven || null,
        isProfileLocked || false, connectRequestSent || false,
        didUnfriend || false, referenceName || null,
        callDate || null, finalCallDate || null, comments || null,
      ]
    );

    await logActivity(trackerId, req.user.userId, 'CALLER_INTERACTION_ADDED', leadId, {
      callerOrder,
      callerId: callerUserId,
      status,
    });

    res.status(201).json({
      success: true,
      data: { id: result.insertId, callerOrder },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/trackers/:id/leads/:leadId/caller-interactions/:iid
router.put('/:id/leads/:leadId/caller-interactions/:iid', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER'), async (req, res, next) => {
  try {
    const { id: trackerId, leadId, iid } = req.params;
    const {
      status,
      profileLinkGiven,
      isProfileLocked,
      connectRequestSent,
      didUnfriend,
      referenceName,
      callDate,
      finalCallDate,
      comments,
    } = req.body;

    await query(
      `UPDATE CallerInteractions SET
        status = COALESCE(?, status),
        profileLinkGiven = COALESCE(?, profileLinkGiven),
        isProfileLocked = COALESCE(?, isProfileLocked),
        connectRequestSent = COALESCE(?, connectRequestSent),
        didUnfriend = COALESCE(?, didUnfriend),
        referenceName = COALESCE(?, referenceName),
        callDate = COALESCE(?, callDate),
        finalCallDate = COALESCE(?, finalCallDate),
        comments = COALESCE(?, comments)
       WHERE id = ? AND leadId = ?`,
      [
        status, profileLinkGiven, isProfileLocked, connectRequestSent,
        didUnfriend, referenceName, callDate, finalCallDate, comments,
        iid, leadId,
      ]
    );

    await logActivity(trackerId, req.user.userId, 'CALLER_INTERACTION_UPDATED', leadId, { interactionId: iid });

    res.json({ success: true, message: 'Interaction updated' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/trackers/:id/leads/:leadId/caller-interactions/:iid
router.delete('/:id/leads/:leadId/caller-interactions/:iid', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { leadId, iid } = req.params;
    await query('DELETE FROM CallerInteractions WHERE id = ? AND leadId = ?', [iid, leadId]);
    res.json({ success: true, message: 'Interaction deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
