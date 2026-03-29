const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole, canAddLead, canEditLead } = require('../middleware/permissions');
const { logActivity } = require('../services/activityLog');

const router = express.Router();

// Validation
const validateLead = [
  body('leadType').isIn(['NEW', 'YELLOW']).withMessage('Lead type must be NEW or YELLOW'),
  body('country').notEmpty().trim().withMessage('Country required'),
  body('leadWants').notEmpty().trim().withMessage('Lead wants required'),
  body('description').notEmpty().trim().withMessage('Description required'),
];

// Duplicate detection helper
async function checkDuplicates(trackerId, leadEmail, leadName, excludeLeadId = null) {
  if (!leadEmail && !leadName) return [];
  const conditions = [];
  const params = [trackerId];

  if (leadEmail) {
    conditions.push('l.leadEmail = ?');
    params.push(leadEmail);
  }
  if (leadName) {
    conditions.push('l.leadName = ?');
    params.push(leadName);
  }

  let sql = `SELECT l.leadId, l.leadName, l.leadEmail FROM Leads l WHERE l.trackerId = ? AND (${conditions.join(' OR ')})`;
  if (excludeLeadId) {
    sql += ' AND l.leadId != ?';
    params.push(excludeLeadId);
  }
  sql += ' LIMIT 5';
  return await query(sql, params);
}

// POST /api/trackers/:id/leads - Add lead
router.post('/:id/leads', authenticate, canAddLead, validateLead, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id: trackerId } = req.params;
    const userId = req.user.userId;
    const {
      leadType, country, city, leadWants, description, notesForTeam, additionalDetails,
      leadName, leadEmail, leadContact, signupDate, sourceChannel, sourceBdaId,
    } = req.body;

    // Get user phone for auto-fill
    const userResult = await query('SELECT phoneNumber FROM Users WHERE userId = ?', [userId]);
    const userPhone = userResult[0]?.phoneNumber || null;

    // Auto-generate serial number
    const maxSerial = await query(
      'SELECT MAX(serialNumber) as maxSerial FROM Leads WHERE trackerId = ?',
      [trackerId]
    );
    const serialNumber = (maxSerial[0]?.maxSerial || 0) + 1;

    // Duplicate detection
    const duplicates = await checkDuplicates(trackerId, leadEmail, leadName);
    const isDuplicate = duplicates.length > 0;

    const leadId = uuidv4();
    const now = new Date();
    const monthAdded = now.getMonth() + 1;
    const yearAdded = now.getFullYear();

    await query(
      `INSERT INTO Leads (leadId, serialNumber, leadName, leadEmail, leadContact, signupDate,
                          sourceChannel, sourceBdaId, isDuplicate, finalStatus,
                          trackerId, leadOwnerId, leadOwnerPhone, leadType, country, city,
                          leadWants, description, notesForTeam, additionalDetails,
                          createdAt, monthAdded, yearAdded, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leadId, serialNumber, leadName || null, leadEmail || null, leadContact || null,
        signupDate || null, sourceChannel || null, sourceBdaId || null, isDuplicate,
        trackerId, userId, userPhone, leadType, country, city || null,
        leadWants, description, notesForTeam || null, additionalDetails || null,
        now, monthAdded, yearAdded, now,
      ]
    );

    if (isDuplicate) {
      await logActivity(trackerId, userId, 'DUPLICATE_DETECTED', leadId, {
        duplicateOf: duplicates.map(d => d.leadId),
      });
    }

    await logActivity(trackerId, userId, 'LEAD_ADDED', leadId, { leadWants, country, leadName });

    res.status(201).json({
      success: true,
      message: isDuplicate ? 'Lead added (potential duplicate detected)' : 'Lead added successfully',
      data: { leadId, serialNumber, isDuplicate, duplicates: isDuplicate ? duplicates : undefined },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/leads - List leads with filters
router.get('/:id/leads', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER', 'VIEWER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;
    const { leadType, month, year, country, city, leadWants, ownerId, search, page = 1, limit = 20 } = req.query;

    let whereClause = 'WHERE l.trackerId = ?';
    const params = [trackerId];

    if (leadType) { whereClause += ' AND l.leadType = ?'; params.push(leadType); }
    if (month) { whereClause += ' AND l.monthAdded = ?'; params.push(parseInt(month)); }
    if (year) { whereClause += ' AND l.yearAdded = ?'; params.push(parseInt(year)); }
    if (country) { whereClause += ' AND l.country = ?'; params.push(country); }
    if (city) { whereClause += ' AND l.city = ?'; params.push(city); }
    if (leadWants) { whereClause += ' AND l.leadWants = ?'; params.push(leadWants); }
    if (ownerId) { whereClause += ' AND l.leadOwnerId = ?'; params.push(ownerId); }
    if (req.query.status) { whereClause += ' AND l.status = ?'; params.push(req.query.status); }
    if (req.query.assignedTo) { whereClause += ' AND l.assignedTo = ?'; params.push(req.query.assignedTo); }
    if (req.query.sourceChannel) { whereClause += ' AND l.sourceChannel = ?'; params.push(req.query.sourceChannel); }
    if (req.query.sourceBdaId) { whereClause += ' AND l.sourceBdaId = ?'; params.push(req.query.sourceBdaId); }
    if (req.query.duplicatesOnly === 'true') { whereClause += ' AND l.isDuplicate = TRUE'; }

    if (search) {
      whereClause += ' AND (l.description LIKE ? OR l.notesForTeam LIKE ? OR l.leadName LIKE ? OR l.leadEmail LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const countResult = await query(`SELECT COUNT(*) as total FROM Leads l ${whereClause}`, params);
    const total = countResult[0].total;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paginatedParams = [...params, parseInt(limit), offset];

    const result = await query(
      `SELECT l.*, u.email as ownerEmail, u.name as ownerName,
              a.name as assignedToName, a.email as assignedToEmail,
              sb.name as sourceBdaName, sb.email as sourceBdaEmail
       FROM Leads l
       INNER JOIN Users u ON l.leadOwnerId = u.userId
       LEFT JOIN Users a ON l.assignedTo = a.userId
       LEFT JOIN Users sb ON l.sourceBdaId = sb.userId
       ${whereClause}
       ORDER BY l.createdAt DESC
       LIMIT ? OFFSET ?`,
      paginatedParams
    );

    res.json({
      success: true,
      data: result,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/leads/:leadId - Get single lead
router.get('/:id/leads/:leadId', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER', 'VIEWER'), async (req, res, next) => {
  try {
    const { id: trackerId, leadId } = req.params;

    const result = await query(
      `SELECT l.*, u.email as ownerEmail, u.name as ownerName, u.phoneNumber as ownerPhone,
              a.name as assignedToName, a.email as assignedToEmail,
              sb.name as sourceBdaName, sb.email as sourceBdaEmail
       FROM Leads l
       INNER JOIN Users u ON l.leadOwnerId = u.userId
       LEFT JOIN Users a ON l.assignedTo = a.userId
       LEFT JOIN Users sb ON l.sourceBdaId = sb.userId
       WHERE l.leadId = ? AND l.trackerId = ?`,
      [leadId, trackerId]
    );

    if (result.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    res.json({ success: true, data: result[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/leads/:leadId/full - Get lead with caller interactions
router.get('/:id/leads/:leadId/full', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER', 'VIEWER'), async (req, res, next) => {
  try {
    const { id: trackerId, leadId } = req.params;

    const leadResult = await query(
      `SELECT l.*, u.email as ownerEmail, u.name as ownerName, u.phoneNumber as ownerPhone,
              a.name as assignedToName, a.email as assignedToEmail,
              sb.name as sourceBdaName, sb.email as sourceBdaEmail
       FROM Leads l
       INNER JOIN Users u ON l.leadOwnerId = u.userId
       LEFT JOIN Users a ON l.assignedTo = a.userId
       LEFT JOIN Users sb ON l.sourceBdaId = sb.userId
       WHERE l.leadId = ? AND l.trackerId = ?`,
      [leadId, trackerId]
    );

    if (leadResult.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const interactions = await query(
      `SELECT ci.*, u.name as callerName, u.email as callerEmail
       FROM CallerInteractions ci
       INNER JOIN Users u ON ci.callerId = u.userId
       WHERE ci.leadId = ?
       ORDER BY ci.callerOrder ASC`,
      [leadId]
    );

    res.json({
      success: true,
      data: { ...leadResult[0], callerInteractions: interactions },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/trackers/:id/leads/:leadId - Update lead
router.put('/:id/leads/:leadId', authenticate, canEditLead, async (req, res, next) => {
  try {
    const { id: trackerId, leadId } = req.params;
    const {
      leadType, country, city, leadWants, description, notesForTeam, additionalDetails,
      leadName, leadEmail, leadContact, signupDate, sourceChannel, sourceBdaId, finalStatus,
    } = req.body;

    // Re-check duplicates if email or name changed
    let isDuplicate;
    if (leadEmail !== undefined || leadName !== undefined) {
      const duplicates = await checkDuplicates(trackerId, leadEmail, leadName, leadId);
      isDuplicate = duplicates.length > 0;
    }

    const now = new Date();

    await query(
      `UPDATE Leads
       SET leadType = COALESCE(?, leadType),
           country = COALESCE(?, country),
           city = COALESCE(?, city),
           leadWants = COALESCE(?, leadWants),
           description = COALESCE(?, description),
           notesForTeam = COALESCE(?, notesForTeam),
           additionalDetails = COALESCE(?, additionalDetails),
           leadName = COALESCE(?, leadName),
           leadEmail = COALESCE(?, leadEmail),
           leadContact = COALESCE(?, leadContact),
           signupDate = COALESCE(?, signupDate),
           sourceChannel = COALESCE(?, sourceChannel),
           sourceBdaId = COALESCE(?, sourceBdaId),
           finalStatus = COALESCE(?, finalStatus),
           isDuplicate = COALESCE(?, isDuplicate),
           updatedAt = ?
       WHERE leadId = ? AND trackerId = ?`,
      [
        leadType ?? null, country ?? null, city ?? null, leadWants ?? null, description ?? null, notesForTeam ?? null, additionalDetails ?? null,
        leadName ?? null, leadEmail ?? null, leadContact ?? null, signupDate ?? null, sourceChannel ?? null, sourceBdaId ?? null, finalStatus ?? null,
        isDuplicate !== undefined ? isDuplicate : null,
        now, leadId, trackerId,
      ]
    );

    await logActivity(trackerId, req.user.userId, 'LEAD_EDITED', leadId);

    res.json({ success: true, message: 'Lead updated successfully' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/trackers/:id/leads/:leadId/status - Change lead status
router.put('/:id/leads/:leadId/status', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER'), async (req, res, next) => {
  try {
    const { id: trackerId, leadId } = req.params;
    const { status } = req.body;

    // Dynamic validation: check against tracker's custom lead statuses
    const customStatuses = await query(
      'SELECT statusName FROM TrackerCustomStatuses WHERE trackerId = ? AND category = ?',
      [trackerId, 'LEAD']
    );
    const validStatuses = customStatuses.map(s => s.statusName);

    if (validStatuses.length > 0 && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const lead = await query('SELECT status FROM Leads WHERE leadId = ? AND trackerId = ?', [leadId, trackerId]);
    if (lead.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const oldStatus = lead[0].status;
    await query('UPDATE Leads SET status = ?, updatedAt = ? WHERE leadId = ?', [status, new Date(), leadId]);
    await logActivity(trackerId, req.user.userId, 'STATUS_CHANGED', leadId, { from: oldStatus, to: status });

    res.json({ success: true, message: 'Status updated' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/trackers/:id/leads/:leadId/assign - Assign lead to team member
router.put('/:id/leads/:leadId/assign', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id: trackerId, leadId } = req.params;
    const { assignedTo } = req.body;

    if (assignedTo) {
      const member = await query(
        'SELECT id FROM TrackerMembers WHERE trackerId = ? AND userId = ?',
        [trackerId, assignedTo]
      );
      if (member.length === 0) {
        return res.status(400).json({ success: false, message: 'User is not a member of this tracker' });
      }
    }

    await query('UPDATE Leads SET assignedTo = ?, assignedDate = ?, updatedAt = ? WHERE leadId = ? AND trackerId = ?',
      [assignedTo || null, assignedTo ? new Date() : null, new Date(), leadId, trackerId]);

    const assigneeName = assignedTo
      ? (await query('SELECT name, email FROM Users WHERE userId = ?', [assignedTo]))[0]
      : null;

    await logActivity(trackerId, req.user.userId, 'LEAD_ASSIGNED', leadId, {
      assignedTo: assigneeName ? `${assigneeName.name} (${assigneeName.email})` : 'Unassigned'
    });

    res.json({ success: true, message: 'Lead assigned' });
  } catch (error) {
    next(error);
  }
});

// GET /api/trackers/:id/leads/check-duplicate - Check for duplicates before adding
router.get('/:id/leads/check-duplicate', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;
    const { email, name } = req.query;
    const duplicates = await checkDuplicates(trackerId, email, name);
    res.json({ success: true, data: { isDuplicate: duplicates.length > 0, duplicates } });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/trackers/:id/leads/:leadId - Delete lead
router.delete('/:id/leads/:leadId', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id: trackerId, leadId } = req.params;

    const result = await query(
      'DELETE FROM Leads WHERE leadId = ? AND trackerId = ?',
      [leadId, trackerId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    await logActivity(trackerId, req.user.userId, 'LEAD_DELETED', leadId);

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
