const { query } = require('../config/database');

async function getTrackerMembership(userId, trackerId) {
  const result = await query(
    `SELECT role, canAddLeads, canEditLeads
     FROM TrackerMembers
     WHERE userId = ? AND trackerId = ?`,
    [userId, trackerId]
  );
  return result[0] || null;
}

async function getTrackerDetails(trackerId) {
  const result = await query(
    `SELECT trackerId, trackerName, businessName, trackerMode, createdBy
     FROM Trackers
     WHERE trackerId = ?`,
    [trackerId]
  );
  return result[0] || null;
}

function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    const trackerId = req.params.trackerId || req.params.id;
    const userId = req.user.userId;

    if (!trackerId) {
      return res.status(400).json({
        success: false,
        message: 'Tracker ID required',
      });
    }

    const membership = await getTrackerMembership(userId, trackerId);

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this tracker',
      });
    }

    if (!allowedRoles.includes(membership.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
      });
    }

    req.membership = membership;
    next();
  };
}

async function canAddLead(req, res, next) {
  const trackerId = req.params.trackerId || req.params.id;
  const userId = req.user.userId;

  const tracker = await getTrackerDetails(trackerId);
  if (!tracker) {
    return res.status(404).json({
      success: false,
      message: 'Tracker not found',
    });
  }

  const membership = await getTrackerMembership(userId, trackerId);
  if (!membership) {
    return res.status(403).json({
      success: false,
      message: 'You do not have access to this tracker',
    });
  }

  // SINGULAR mode: only ADMIN/OWNER can add leads
  if (tracker.trackerMode === 'SINGULAR') {
    if (!['ADMIN', 'OWNER'].includes(membership.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only owner/admin can add leads in singular mode',
      });
    }
  } else {
    // MULTI mode: check canAddLeads permission
    if (!membership.canAddLeads && !['ADMIN', 'OWNER'].includes(membership.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to add leads',
      });
    }
  }

  req.tracker = tracker;
  req.membership = membership;
  next();
}

async function canEditLead(req, res, next) {
  const trackerId = req.params.trackerId || req.params.id;
  const userId = req.user.userId;

  const membership = await getTrackerMembership(userId, trackerId);
  if (!membership) {
    return res.status(403).json({
      success: false,
      message: 'You do not have access to this tracker',
    });
  }

  if (!membership.canEditLeads && !['ADMIN', 'OWNER'].includes(membership.role)) {
    return res.status(403).json({
      success: false,
      message: 'You do not have permission to edit leads',
    });
  }

  req.membership = membership;
  next();
}

module.exports = {
  requireRole,
  canAddLead,
  canEditLead,
  getTrackerMembership,
  getTrackerDetails,
};
