const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');

const router = express.Router();

// GET /api/trackers/:id/team/dashboard - Team dashboard with per-member stats
router.get('/:id/team/dashboard', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;

    // Per-member lead counts
    const memberStats = await query(
      `SELECT u.userId, u.name, u.email, tm.role,
              COUNT(l.leadId) as totalLeads,
              SUM(CASE WHEN l.status = 'NEW' THEN 1 ELSE 0 END) as newLeads,
              SUM(CASE WHEN l.status = 'CONTACTED' THEN 1 ELSE 0 END) as contactedLeads,
              SUM(CASE WHEN l.status = 'QUALIFIED' THEN 1 ELSE 0 END) as qualifiedLeads,
              SUM(CASE WHEN l.status = 'CONVERTED' THEN 1 ELSE 0 END) as convertedLeads,
              SUM(CASE WHEN l.status = 'LOST' THEN 1 ELSE 0 END) as lostLeads
       FROM TrackerMembers tm
       INNER JOIN Users u ON tm.userId = u.userId
       LEFT JOIN Leads l ON l.leadOwnerId = u.userId AND l.trackerId = tm.trackerId
       WHERE tm.trackerId = ?
       GROUP BY u.userId, u.name, u.email, tm.role
       ORDER BY totalLeads DESC`,
      [trackerId]
    );

    // Overall status breakdown
    const statusBreakdown = await query(
      `SELECT status, COUNT(*) as count FROM Leads WHERE trackerId = ? GROUP BY status`,
      [trackerId]
    );

    // Leads assigned but not converted
    const assignmentStats = await query(
      `SELECT u.name, u.email,
              COUNT(l.leadId) as assignedLeads,
              SUM(CASE WHEN l.status = 'CONVERTED' THEN 1 ELSE 0 END) as converted
       FROM Leads l
       INNER JOIN Users u ON l.assignedTo = u.userId
       WHERE l.trackerId = ? AND l.assignedTo IS NOT NULL
       GROUP BY u.userId, u.name, u.email`,
      [trackerId]
    );

    // Total leads
    const totalResult = await query(
      'SELECT COUNT(*) as total FROM Leads WHERE trackerId = ?',
      [trackerId]
    );

    res.json({
      success: true,
      data: {
        totalLeads: totalResult[0].total,
        statusBreakdown,
        memberStats,
        assignmentStats,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/team/activity - Activity log
router.get('/:id/team/activity', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER', 'VIEWER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;
    const { page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT a.id, a.action, a.details, a.createdAt, a.leadId,
              u.name as userName, u.email as userEmail
       FROM ActivityLog a
       INNER JOIN Users u ON a.userId = u.userId
       WHERE a.trackerId = ?
       ORDER BY a.createdAt DESC
       LIMIT ? OFFSET ?`,
      [trackerId, parseInt(limit), offset]
    );

    const countResult = await query(
      'SELECT COUNT(*) as total FROM ActivityLog WHERE trackerId = ?',
      [trackerId]
    );

    res.json({
      success: true,
      data: result,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
