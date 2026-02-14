const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { getTrackerMembership } = require('../middleware/permissions');

const router = express.Router();

// Helper: build date filter condition (prefix = table alias, e.g. 'l' for Leads)
function buildDateFilter(startDate, endDate, prefix = '') {
  const col = prefix ? `${prefix}.createdAt` : 'createdAt';
  if (startDate && endDate) {
    return { condition: `${col} >= ? AND ${col} < DATE_ADD(?, INTERVAL 1 DAY)`, params: [startDate, endDate] };
  }
  // Default: 1st of current month to today
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { condition: `${col} >= ? AND ${col} < DATE_ADD(?, INTERVAL 1 DAY)`, params: [firstOfMonth, today] };
}

// GET /api/analytics/tracker/:id - Single tracker analytics
router.get('/tracker/:id', authenticate, async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;
    const { startDate, endDate, month, year } = req.query;
    const userId = req.user.userId;

    // Check access
    const membership = await getTrackerMembership(userId, trackerId);
    if (!membership) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Support both new date range and legacy month/year
    let sDate, eDate;
    if (startDate && endDate) {
      sDate = startDate; eDate = endDate;
    } else if (month && year) {
      const m = parseInt(month);
      const y = parseInt(year);
      sDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear = m === 12 ? y + 1 : y;
      eDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    } else {
      sDate = null; eDate = null;
    }

    // Unprefixed for single-table queries, prefixed with 'l' for JOINed queries
    const df = buildDateFilter(sDate, eDate);
    const dfL = buildDateFilter(sDate, eDate, 'l');
    const dc = df.condition;
    const dp = df.params;
    const dcL = dfL.condition;
    const dpL = dfL.params;

    // Total leads + duplicate count
    const totalResult = await query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN isDuplicate = TRUE THEN 1 ELSE 0 END) as duplicateCount FROM Leads
       WHERE trackerId = ? AND ${dc}`,
      [trackerId, ...dp]
    );

    const totalLeads = totalResult[0].total;
    const duplicateCount = totalResult[0].duplicateCount || 0;
    const duplicateRate = totalLeads > 0 ? Math.round((duplicateCount / totalLeads) * 100 * 10) / 10 : 0;

    // Lead type breakdown
    const typeBreakdown = await query(
      `SELECT leadType, COUNT(*) as count FROM Leads
       WHERE trackerId = ? AND ${dc}
       GROUP BY leadType`,
      [trackerId, ...dp]
    );

    // Lead status breakdown
    const statusBreakdown = await query(
      `SELECT status, COUNT(*) as count FROM Leads
       WHERE trackerId = ? AND ${dc}
       GROUP BY status`,
      [trackerId, ...dp]
    );

    const byStatus = statusBreakdown.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    // Conversion rate
    const convertedCount = byStatus['CONVERTED'] || 0;
    const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100 * 10) / 10 : 0;

    // Lead wants breakdown
    const wantsBreakdown = await query(
      `SELECT leadWants, COUNT(*) as count FROM Leads
       WHERE trackerId = ? AND ${dc}
       GROUP BY leadWants`,
      [trackerId, ...dp]
    );

    // Source channel breakdown
    const sourceChannelBreakdown = await query(
      `SELECT sourceChannel, COUNT(*) as count FROM Leads
       WHERE trackerId = ? AND ${dc} AND sourceChannel IS NOT NULL AND sourceChannel != ''
       GROUP BY sourceChannel ORDER BY count DESC`,
      [trackerId, ...dp]
    );

    // Country breakdown
    const countryBreakdown = await query(
      `SELECT country, COUNT(*) as count FROM Leads
       WHERE trackerId = ? AND ${dc}
       GROUP BY country
       ORDER BY count DESC`,
      [trackerId, ...dp]
    );

    // Caller interaction stats
    let callerStats = { totalInteractions: 0, leadsWithInteractions: 0, totalLeadsInRange: totalLeads, avgCallersPerLead: 0, leadsWithNoInteractions: totalLeads };
    try {
      const ciResult = await query(
        `SELECT COUNT(ci.id) as totalInteractions,
          COUNT(DISTINCT ci.leadId) as leadsWithInteractions
        FROM Leads l LEFT JOIN CallerInteractions ci ON ci.leadId = l.leadId
        WHERE l.trackerId = ? AND ${dcL}`,
        [trackerId, ...dpL]
      );
      const totalInteractions = ciResult[0].totalInteractions || 0;
      const leadsWithInteractions = ciResult[0].leadsWithInteractions || 0;
      callerStats = {
        totalInteractions,
        leadsWithInteractions,
        totalLeadsInRange: totalLeads,
        avgCallersPerLead: totalLeads > 0 ? Math.round((totalInteractions / totalLeads) * 10) / 10 : 0,
        leadsWithNoInteractions: totalLeads - leadsWithInteractions,
      };
    } catch (e) {
      // CallerInteractions table may not exist, ignore
    }

    // Response time (avg hours from lead creation to first caller interaction)
    let responseTime = { avgHours: null, formatted: 'N/A' };
    try {
      const rtResult = await query(
        `SELECT AVG(TIMESTAMPDIFF(HOUR, l.createdAt, ci.firstInteraction)) as avgResponseHours
        FROM Leads l INNER JOIN (
          SELECT leadId, MIN(createdAt) as firstInteraction FROM CallerInteractions GROUP BY leadId
        ) ci ON ci.leadId = l.leadId
        WHERE l.trackerId = ? AND ${dcL}`,
        [trackerId, ...dpL]
      );
      const avgHours = rtResult[0].avgResponseHours;
      if (avgHours !== null) {
        responseTime = {
          avgHours: Math.round(avgHours * 10) / 10,
          formatted: avgHours >= 24 ? `${(avgHours / 24).toFixed(1)} days` : `${avgHours.toFixed(1)} hours`,
        };
      }
    } catch (e) {
      // CallerInteractions table may not exist
    }

    // BDA/Team member performance
    let memberPerformance = [];
    try {
      memberPerformance = await query(
        `SELECT u.userId, u.name, u.email,
          SUM(CASE WHEN l.sourceBdaId = u.userId THEN 1 ELSE 0 END) as leadsSourced,
          SUM(CASE WHEN l.assignedTo = u.userId THEN 1 ELSE 0 END) as leadsAssigned
        FROM TrackerMembers tm
        INNER JOIN Users u ON tm.userId = u.userId
        LEFT JOIN Leads l ON l.trackerId = tm.trackerId AND (l.sourceBdaId = u.userId OR l.assignedTo = u.userId) AND ${dcL}
        WHERE tm.trackerId = ?
        GROUP BY u.userId, u.name, u.email
        HAVING leadsSourced > 0 OR leadsAssigned > 0`,
        [...dpL, trackerId]
      );
    } catch (e) {
      // Ignore errors
    }

    // Monthly trend (last 6 months from endDate or current)
    const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();
    const trendResult = await query(
      `SELECT monthAdded, yearAdded, COUNT(*) as count FROM Leads
       WHERE trackerId = ?
       AND (yearAdded * 12 + monthAdded) >= (? * 12 + ? - 5)
       GROUP BY monthAdded, yearAdded
       ORDER BY yearAdded, monthAdded`,
      [trackerId, currentYear, currentMonth]
    );

    res.json({
      success: true,
      data: {
        period: { startDate: dp[0], endDate: dp[1] },
        totalLeads,
        duplicateCount,
        duplicateRate,
        conversionRate,
        byType: typeBreakdown.reduce((acc, row) => {
          acc[row.leadType] = row.count;
          return acc;
        }, {}),
        byStatus,
        byWants: wantsBreakdown,
        bySourceChannel: sourceChannelBreakdown,
        byCountry: countryBreakdown,
        callerStats,
        responseTime,
        memberPerformance,
        monthlyTrend: trendResult,
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/analytics/multi - Multi-tracker analytics
router.post('/multi', authenticate, async (req, res, next) => {
  try {
    const { trackerIds, startDate, endDate, month, year } = req.body;
    const userId = req.user.userId;

    if (!trackerIds || !Array.isArray(trackerIds) || trackerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Tracker IDs required' });
    }

    // Verify access to all trackers
    const accessChecks = await Promise.all(
      trackerIds.map((id) => getTrackerMembership(userId, id))
    );

    const accessibleTrackerIds = trackerIds.filter((_, index) => accessChecks[index]);
    if (accessibleTrackerIds.length === 0) {
      return res.status(403).json({ success: false, message: 'No access to any selected trackers' });
    }

    // Support both new date range and legacy month/year
    let sDate, eDate;
    if (startDate && endDate) {
      sDate = startDate; eDate = endDate;
    } else if (month && year) {
      const m = parseInt(month);
      const y = parseInt(year);
      sDate = `${y}-${String(m).padStart(2, '0')}-01`;
      const nextMonth = m === 12 ? 1 : m + 1;
      const nextYear = m === 12 ? y + 1 : y;
      eDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    } else {
      sDate = null; eDate = null;
    }

    const df = buildDateFilter(sDate, eDate);
    const dfL = buildDateFilter(sDate, eDate, 'l');
    const dc = df.condition;
    const dp = df.params;
    const dcL = dfL.condition;
    const dpL = dfL.params;

    // Build IN clause for tracker IDs
    const placeholders = accessibleTrackerIds.map(() => '?').join(',');

    // Combined totals + duplicate count
    const totalResult = await query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN isDuplicate = TRUE THEN 1 ELSE 0 END) as duplicateCount FROM Leads
       WHERE trackerId IN (${placeholders}) AND ${dc}`,
      [...accessibleTrackerIds, ...dp]
    );

    const totalLeads = totalResult[0].total;
    const duplicateCount = totalResult[0].duplicateCount || 0;
    const duplicateRate = totalLeads > 0 ? Math.round((duplicateCount / totalLeads) * 100 * 10) / 10 : 0;

    // Per-tracker breakdown
    const perTrackerResult = await query(
      `SELECT l.trackerId, t.trackerName, t.businessName, COUNT(*) as count
       FROM Leads l
       INNER JOIN Trackers t ON l.trackerId = t.trackerId
       WHERE l.trackerId IN (${placeholders}) AND ${dcL}
       GROUP BY l.trackerId, t.trackerName, t.businessName`,
      [...accessibleTrackerIds, ...dpL]
    );

    // Combined type breakdown
    const typeBreakdown = await query(
      `SELECT leadType, COUNT(*) as count FROM Leads
       WHERE trackerId IN (${placeholders}) AND ${dc}
       GROUP BY leadType`,
      [...accessibleTrackerIds, ...dp]
    );

    // Status breakdown
    const statusBreakdown = await query(
      `SELECT status, COUNT(*) as count FROM Leads
       WHERE trackerId IN (${placeholders}) AND ${dc}
       GROUP BY status`,
      [...accessibleTrackerIds, ...dp]
    );

    const byStatus = statusBreakdown.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    const convertedCount = byStatus['CONVERTED'] || 0;
    const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 100 * 10) / 10 : 0;

    // Combined wants breakdown
    const wantsBreakdown = await query(
      `SELECT leadWants, COUNT(*) as count FROM Leads
       WHERE trackerId IN (${placeholders}) AND ${dc}
       GROUP BY leadWants
       ORDER BY count DESC`,
      [...accessibleTrackerIds, ...dp]
    );

    // Source channel breakdown
    const sourceChannelBreakdown = await query(
      `SELECT sourceChannel, COUNT(*) as count FROM Leads
       WHERE trackerId IN (${placeholders}) AND ${dc} AND sourceChannel IS NOT NULL AND sourceChannel != ''
       GROUP BY sourceChannel ORDER BY count DESC`,
      [...accessibleTrackerIds, ...dp]
    );

    // Caller interaction stats
    let callerStats = { totalInteractions: 0, leadsWithInteractions: 0, totalLeadsInRange: totalLeads, avgCallersPerLead: 0, leadsWithNoInteractions: totalLeads };
    try {
      const ciResult = await query(
        `SELECT COUNT(ci.id) as totalInteractions,
          COUNT(DISTINCT ci.leadId) as leadsWithInteractions
        FROM Leads l LEFT JOIN CallerInteractions ci ON ci.leadId = l.leadId
        WHERE l.trackerId IN (${placeholders}) AND ${dcL}`,
        [...accessibleTrackerIds, ...dpL]
      );
      const totalInteractions = ciResult[0].totalInteractions || 0;
      const leadsWithInteractions = ciResult[0].leadsWithInteractions || 0;
      callerStats = {
        totalInteractions,
        leadsWithInteractions,
        totalLeadsInRange: totalLeads,
        avgCallersPerLead: totalLeads > 0 ? Math.round((totalInteractions / totalLeads) * 10) / 10 : 0,
        leadsWithNoInteractions: totalLeads - leadsWithInteractions,
      };
    } catch (e) {
      // CallerInteractions table may not exist
    }

    // Response time
    let responseTime = { avgHours: null, formatted: 'N/A' };
    try {
      const rtResult = await query(
        `SELECT AVG(TIMESTAMPDIFF(HOUR, l.createdAt, ci.firstInteraction)) as avgResponseHours
        FROM Leads l INNER JOIN (
          SELECT leadId, MIN(createdAt) as firstInteraction FROM CallerInteractions GROUP BY leadId
        ) ci ON ci.leadId = l.leadId
        WHERE l.trackerId IN (${placeholders}) AND ${dcL}`,
        [...accessibleTrackerIds, ...dpL]
      );
      const avgHours = rtResult[0].avgResponseHours;
      if (avgHours !== null) {
        responseTime = {
          avgHours: Math.round(avgHours * 10) / 10,
          formatted: avgHours >= 24 ? `${(avgHours / 24).toFixed(1)} days` : `${avgHours.toFixed(1)} hours`,
        };
      }
    } catch (e) {
      // Ignore
    }

    // BDA/Team member performance (across all selected trackers)
    let memberPerformance = [];
    try {
      memberPerformance = await query(
        `SELECT u.userId, u.name, u.email,
          SUM(CASE WHEN l.sourceBdaId = u.userId THEN 1 ELSE 0 END) as leadsSourced,
          SUM(CASE WHEN l.assignedTo = u.userId THEN 1 ELSE 0 END) as leadsAssigned
        FROM TrackerMembers tm
        INNER JOIN Users u ON tm.userId = u.userId
        LEFT JOIN Leads l ON l.trackerId = tm.trackerId AND (l.sourceBdaId = u.userId OR l.assignedTo = u.userId) AND ${dcL}
        WHERE tm.trackerId IN (${placeholders})
        GROUP BY u.userId, u.name, u.email
        HAVING leadsSourced > 0 OR leadsAssigned > 0`,
        [...dpL, ...accessibleTrackerIds]
      );
    } catch (e) {
      // Ignore
    }

    res.json({
      success: true,
      data: {
        period: { startDate: dp[0], endDate: dp[1] },
        trackersIncluded: accessibleTrackerIds.length,
        totalLeads,
        duplicateCount,
        duplicateRate,
        conversionRate,
        perTracker: perTrackerResult,
        byType: typeBreakdown.reduce((acc, row) => {
          acc[row.leadType] = row.count;
          return acc;
        }, {}),
        byStatus,
        byWants: wantsBreakdown,
        bySourceChannel: sourceChannelBreakdown,
        callerStats,
        responseTime,
        memberPerformance,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
