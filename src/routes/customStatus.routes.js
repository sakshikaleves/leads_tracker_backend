const express = require('express');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');

const router = express.Router();

// GET /api/trackers/:id/custom-statuses - List custom statuses for a tracker
router.get('/:id/custom-statuses', authenticate, requireRole('ADMIN', 'OWNER', 'BDA', 'MEMBER', 'VIEWER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;
    const result = await query(
      'SELECT * FROM TrackerCustomStatuses WHERE trackerId = ? ORDER BY statusOrder ASC',
      [trackerId]
    );
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/trackers/:id/custom-statuses - Create custom status
router.post('/:id/custom-statuses', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { id: trackerId } = req.params;
    const { statusName, statusColor = 'gray', statusType = 'NEUTRAL' } = req.body;

    if (!statusName || !statusName.trim()) {
      return res.status(400).json({ success: false, message: 'Status name is required' });
    }

    // Get next order
    const maxOrder = await query(
      'SELECT MAX(statusOrder) as maxOrder FROM TrackerCustomStatuses WHERE trackerId = ?',
      [trackerId]
    );
    const nextOrder = (maxOrder[0]?.maxOrder || 0) + 1;

    const result = await query(
      'INSERT INTO TrackerCustomStatuses (trackerId, statusName, statusOrder, statusColor, statusType) VALUES (?, ?, ?, ?, ?)',
      [trackerId, statusName.trim(), nextOrder, statusColor, statusType]
    );

    res.status(201).json({
      success: true,
      data: { id: result.insertId, trackerId, statusName: statusName.trim(), statusOrder: nextOrder, statusColor, statusType },
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Status name already exists for this tracker' });
    }
    next(error);
  }
});

// PUT /api/trackers/:id/custom-statuses/:statusId - Update custom status
router.put('/:id/custom-statuses/:statusId', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { statusId } = req.params;
    const { statusName, statusColor, statusType } = req.body;

    await query(
      `UPDATE TrackerCustomStatuses SET
        statusName = COALESCE(?, statusName),
        statusColor = COALESCE(?, statusColor),
        statusType = COALESCE(?, statusType),
        updatedAt = ?
       WHERE id = ?`,
      [statusName, statusColor, statusType, new Date(), statusId]
    );

    res.json({ success: true, message: 'Status updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: 'Status name already exists for this tracker' });
    }
    next(error);
  }
});

// DELETE /api/trackers/:id/custom-statuses/:statusId - Delete custom status
router.delete('/:id/custom-statuses/:statusId', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { statusId } = req.params;

    // Check if in use
    const inUse = await query(
      'SELECT COUNT(*) as count FROM CallerInteractions WHERE status = (SELECT statusName FROM TrackerCustomStatuses WHERE id = ?)',
      [statusId]
    );
    if (inUse[0].count > 0) {
      return res.status(400).json({ success: false, message: 'Cannot delete status that is in use by caller interactions' });
    }

    await query('DELETE FROM TrackerCustomStatuses WHERE id = ?', [statusId]);
    res.json({ success: true, message: 'Status deleted' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/trackers/:id/custom-statuses/reorder - Reorder statuses
router.put('/:id/custom-statuses/reorder', authenticate, requireRole('ADMIN', 'OWNER'), async (req, res, next) => {
  try {
    const { statusIds } = req.body;
    if (!Array.isArray(statusIds)) {
      return res.status(400).json({ success: false, message: 'statusIds array required' });
    }

    for (let i = 0; i < statusIds.length; i++) {
      await query('UPDATE TrackerCustomStatuses SET statusOrder = ? WHERE id = ?', [i + 1, statusIds[i]]);
    }

    res.json({ success: true, message: 'Statuses reordered' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
