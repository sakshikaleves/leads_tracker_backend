const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireSuperAdmin } = require('../middleware/superAdmin');
const config = require('../config/env');
const { sendWelcomeEmail, sendInviteEmail } = require('../services/email.service');

const router = express.Router();

// Helper: check if user is super admin or org admin
async function requireOrgAdmin(req, res, next) {
  const { orgId } = req.params;
  const userId = req.user.userId;

  if (config.superAdminEmails.includes(req.user.email)) {
    return next();
  }

  const result = await query(
    'SELECT role FROM OrgMembers WHERE orgId = ? AND userId = ?',
    [orgId, userId]
  );

  if (!result[0] || result[0].role !== 'ORG_ADMIN') {
    return res.status(403).json({ success: false, message: 'Org admin access required' });
  }

  req.orgMembership = result[0];
  next();
}

// ─── SUPER ADMIN ENDPOINTS ────────────────────────────────────────────────────

// GET /api/admin/orgs — list all orgs
router.get('/admin/orgs', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const orgs = await query(
      `SELECT o.orgId, o.orgName, o.createdAt,
              (SELECT COUNT(*) FROM OrgMembers WHERE orgId = o.orgId) as memberCount,
              (SELECT COUNT(*) FROM Trackers WHERE orgId = o.orgId) as trackerCount,
              u.name as createdByName, u.email as createdByEmail
       FROM Organizations o
       INNER JOIN Users u ON o.createdBy = u.userId
       ORDER BY o.createdAt DESC`
    );
    res.json({ success: true, data: orgs });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/orgs — create org
router.post('/admin/orgs', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { orgName, adminEmail } = req.body;

    if (!orgName || !adminEmail) {
      return res.status(400).json({ success: false, message: 'orgName and adminEmail are required' });
    }

    const orgId = uuidv4();
    const now = new Date();

    await query(
      'INSERT INTO Organizations (orgId, orgName, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [orgId, orgName, req.user.userId, now, now]
    );

    // Check if admin user already exists
    const adminUser = await query('SELECT userId FROM Users WHERE email = ?', [adminEmail]);

    if (adminUser.length > 0) {
      // User exists — add directly as OrgMember
      await query(
        'INSERT INTO OrgMembers (orgId, userId, role, addedBy, createdAt) VALUES (?, ?, ?, ?, ?)',
        [orgId, adminUser[0].userId, 'ORG_ADMIN', req.user.userId, now]
      );
    } else {
      // User not registered yet — create an invitation
      await query(
        'INSERT INTO OrgInvitations (orgId, email, role, invitedBy, createdAt) VALUES (?, ?, ?, ?, ?)',
        [orgId, adminEmail, 'ORG_ADMIN', req.user.userId, now]
      );
    }

    // Send welcome email to the org admin
    sendWelcomeEmail(adminEmail, orgName);

    res.status(201).json({
      success: true,
      message: adminUser.length > 0
        ? 'Organization created successfully'
        : 'Organization created. Invitation sent — admin will get access after registering.',
      data: { orgId, orgName },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/orgs/:orgId — delete org
router.delete('/admin/orgs/:orgId', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { orgId } = req.params;

    const org = await query('SELECT orgId FROM Organizations WHERE orgId = ?', [orgId]);
    if (org.length === 0) {
      return res.status(404).json({ success: false, message: 'Organization not found' });
    }

    await query('DELETE FROM Organizations WHERE orgId = ?', [orgId]);

    res.json({ success: true, message: 'Organization deleted' });
  } catch (error) {
    next(error);
  }
});

// ─── ORG ADMIN ENDPOINTS ──────────────────────────────────────────────────────

// GET /api/orgs/mine — orgs where current user is a member
router.get('/orgs/mine', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const orgs = await query(
      `SELECT o.orgId, o.orgName, o.createdAt, om.role
       FROM Organizations o
       INNER JOIN OrgMembers om ON o.orgId = om.orgId
       WHERE om.userId = ?
       ORDER BY o.orgName`,
      [userId]
    );

    res.json({ success: true, data: orgs });
  } catch (error) {
    next(error);
  }
});

// GET /api/orgs/:orgId/members
router.get('/orgs/:orgId/members', authenticate, requireOrgAdmin, async (req, res, next) => {
  try {
    const { orgId } = req.params;

    const members = await query(
      `SELECT om.id, om.role, om.createdAt,
              u.userId, u.name, u.email, u.phoneNumber
       FROM OrgMembers om
       INNER JOIN Users u ON om.userId = u.userId
       WHERE om.orgId = ?
       ORDER BY om.role, u.name`,
      [orgId]
    );

    const org = await query('SELECT orgId, orgName FROM Organizations WHERE orgId = ?', [orgId]);

    // Get pending invitations
    const invitations = await query(
      `SELECT id, email, role, status, createdAt
       FROM OrgInvitations
       WHERE orgId = ?
       ORDER BY createdAt DESC`,
      [orgId]
    );

    res.json({ success: true, data: { org: org[0], members, invitations } });
  } catch (error) {
    next(error);
  }
});

// POST /api/orgs/:orgId/members — add member by email
router.post('/orgs/:orgId/members', authenticate, requireOrgAdmin, async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { email, role = 'ORG_MEMBER' } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    if (!['ORG_ADMIN', 'ORG_MEMBER'].includes(role)) {
      return res.status(400).json({ success: false, message: 'role must be ORG_ADMIN or ORG_MEMBER' });
    }

    const user = await query('SELECT userId FROM Users WHERE email = ?', [email]);

    if (user.length > 0) {
      // User exists — add directly
      const existing = await query(
        'SELECT id FROM OrgMembers WHERE orgId = ? AND userId = ?',
        [orgId, user[0].userId]
      );
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'User is already a member of this organization' });
      }

      await query(
        'INSERT INTO OrgMembers (orgId, userId, role, addedBy, createdAt) VALUES (?, ?, ?, ?, ?)',
        [orgId, user[0].userId, role, req.user.userId, new Date()]
      );

      res.status(201).json({ success: true, message: 'Member added successfully' });
    } else {
      // User not registered — create invitation
      const existingInvite = await query(
        'SELECT id FROM OrgInvitations WHERE orgId = ? AND email = ?',
        [orgId, email]
      );
      if (existingInvite.length > 0) {
        return res.status(409).json({ success: false, message: 'Invitation already sent to this email' });
      }

      await query(
        'INSERT INTO OrgInvitations (orgId, email, role, invitedBy, createdAt) VALUES (?, ?, ?, ?, ?)',
        [orgId, email, role, req.user.userId, new Date()]
      );

      // Send invite email
      const org = await query('SELECT orgName FROM Organizations WHERE orgId = ?', [orgId]);
      const orgName = org[0]?.orgName || 'your organization';
      sendInviteEmail(email, orgName, req.user.email);

      res.status(201).json({ success: true, message: 'Invitation created. User will be added after they register.' });
    }
  } catch (error) {
    next(error);
  }
});

// PUT /api/orgs/:orgId/members/:userId — update member role
router.put('/orgs/:orgId/members/:userId', authenticate, requireOrgAdmin, async (req, res, next) => {
  try {
    const { orgId, userId } = req.params;
    const { role } = req.body;

    if (!['ORG_ADMIN', 'ORG_MEMBER'].includes(role)) {
      return res.status(400).json({ success: false, message: 'role must be ORG_ADMIN or ORG_MEMBER' });
    }

    const result = await query(
      'UPDATE OrgMembers SET role = ? WHERE orgId = ? AND userId = ?',
      [role, orgId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    res.json({ success: true, message: 'Member role updated' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/orgs/:orgId/members/:userId — remove member
router.delete('/orgs/:orgId/members/:userId', authenticate, requireOrgAdmin, async (req, res, next) => {
  try {
    const { orgId, userId } = req.params;

    const result = await query(
      'DELETE FROM OrgMembers WHERE orgId = ? AND userId = ?',
      [orgId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    res.json({ success: true, message: 'Member removed' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
