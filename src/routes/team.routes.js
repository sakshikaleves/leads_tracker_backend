const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');

const router = express.Router();

// GET /api/trackers/:id/team/dashboard - Team dashboard with per-member stats
router.get('/:id/team/dashboard', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;

    // Per-member lead counts (totals only)
    const memberBasic = await query(
      `SELECT u.userId, u.name, u.email, tm.role,
              COUNT(l.leadId) as totalLeads
       FROM TrackerMembers tm
       INNER JOIN Users u ON tm.userId = u.userId
       LEFT JOIN Leads l ON l.leadOwnerId = u.userId AND l.trackerId = tm.trackerId
       WHERE tm.trackerId = ?
       GROUP BY u.userId, u.name, u.email, tm.role
       ORDER BY totalLeads DESC`,
      [trackerId]
    );

    // Per-member status breakdown (dynamic — works with custom statuses)
    const memberStatusCounts = await query(
      `SELECT l.leadOwnerId as userId, l.status, COUNT(*) as count
       FROM Leads l WHERE l.trackerId = ?
       GROUP BY l.leadOwnerId, l.status`,
      [trackerId]
    );

    // Merge into memberStats
    const memberStats = memberBasic.map(m => {
      const statusCounts = {};
      memberStatusCounts
        .filter(sc => sc.userId === m.userId)
        .forEach(sc => { statusCounts[sc.status] = sc.count; });
      return { ...m, statusCounts };
    });

    // Overall status breakdown
    const statusBreakdown = await query(
      `SELECT status, COUNT(*) as count FROM Leads WHERE trackerId = ? GROUP BY status`,
      [trackerId]
    );

    // Get success status names for this tracker
    const successStatuses = await query(
      `SELECT statusName FROM TrackerCustomStatuses WHERE trackerId = ? AND category = 'LEAD' AND statusType = 'SUCCESS'`,
      [trackerId]
    );
    const successNames = successStatuses.map(s => s.statusName);
    const convertedCondition = successNames.length > 0
      ? `l.status IN (${successNames.map(() => '?').join(',')})`
      : `l.status = 'CONVERTED'`;

    // Leads assigned — with conversion count
    const assignmentStats = await query(
      `SELECT u.name, u.email,
              COUNT(l.leadId) as assignedLeads,
              SUM(CASE WHEN ${convertedCondition} THEN 1 ELSE 0 END) as converted
       FROM Leads l
       INNER JOIN Users u ON l.assignedTo = u.userId
       WHERE l.trackerId = ? AND l.assignedTo IS NOT NULL
       GROUP BY u.userId, u.name, u.email`,
      [...successNames, trackerId]
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
