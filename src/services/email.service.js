const nodemailer = require('nodemailer');
const config = require('../config/env');

// Parse SMTP accounts from env (rotating pool)
let smtpAccounts = [];
try {
  smtpAccounts = JSON.parse(process.env.SMTP_ACCOUNTS_JSON || '[]');
} catch (e) {
  console.warn('[Email] Failed to parse SMTP_ACCOUNTS_JSON:', e.message);
}

let accountIndex = 0;
const transporters = [];

function getTransporter() {
  if (smtpAccounts.length === 0) {
    // Fallback to old single-account config
    if (config.smtp.host && config.smtp.user) {
      if (transporters.length === 0) {
        transporters.push({
          transport: nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.port === 465,
            auth: { user: config.smtp.user, pass: config.smtp.pass },
          }),
          from: config.smtp.from,
        });
      }
      return transporters[0];
    }
    return null;
  }

  // Initialize transporters lazily
  if (transporters.length === 0) {
    for (const acct of smtpAccounts) {
      transporters.push({
        transport: nodemailer.createTransport({
          host: acct.host,
          port: acct.port,
          secure: acct.port === 465,
          auth: { user: acct.user, pass: acct.pass },
        }),
        from: acct.from,
      });
    }
  }

  // Round-robin rotation
  const current = transporters[accountIndex % transporters.length];
  accountIndex = (accountIndex + 1) % transporters.length;
  return current;
}

async function sendEmail(to, subject, html) {
  try {
    const account = getTransporter();
    if (!account) {
      console.log('[Email] SMTP not configured, skipping email to', to);
      return false;
    }
    await account.transport.sendMail({ from: account.from, to, subject, html });
    console.log('[Email] Sent to', to, '| Subject:', subject);
    return true;
  } catch (err) {
    console.error('[Email] Failed to send to', to, ':', err.message);
    return false;
  }
}

// ─── Email Templates ───

function emailWrapper(content) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
      <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 32px 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: #fff; font-size: 22px; margin: 0; font-weight: 700;">Lead Tracker</h1>
      </div>
      <div style="background: #ffffff; padding: 32px 24px; border: 1px solid #e2e8f0; border-top: none;">
        ${content}
      </div>
      <div style="background: #f8fafc; padding: 16px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0; text-align: center;">
          This email was sent by Lead Tracker. If you did not expect this, you can safely ignore it.
        </p>
      </div>
    </div>
  `;
}

function buttonHtml(text, url) {
  return `
    <div style="text-align: center; margin: 28px 0;">
      <a href="${url}" style="background-color: #2563eb; color: #ffffff; padding: 12px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">
        ${text}
      </a>
    </div>
  `;
}

// ─── Specific Email Functions ───

async function sendWelcomeEmail(toEmail, orgName) {
  const registerUrl = `${config.appBaseUrl}/register`;
  return sendEmail(
    toEmail,
    `You've been invited as Admin of ${orgName}`,
    emailWrapper(`
      <h2 style="color: #1e293b; font-size: 20px; margin: 0 0 16px;">Welcome to Lead Tracker!</h2>
      <p style="color: #475569; line-height: 1.6;">You have been added as an <strong>Organization Admin</strong> for <strong>${orgName}</strong>.</p>
      <p style="color: #475569; line-height: 1.6;">To get started, create your account using this email address (<strong>${toEmail}</strong>):</p>
      ${buttonHtml('Register Now', registerUrl)}
      <p style="color: #94a3b8; font-size: 13px;">If the button doesn't work, copy and paste this link: <a href="${registerUrl}" style="color: #2563eb;">${registerUrl}</a></p>
    `)
  );
}

async function sendInviteEmail(toEmail, orgName, inviterName) {
  const registerUrl = `${config.appBaseUrl}/register`;
  return sendEmail(
    toEmail,
    `You've been invited to join ${orgName}`,
    emailWrapper(`
      <h2 style="color: #1e293b; font-size: 20px; margin: 0 0 16px;">You're Invited!</h2>
      <p style="color: #475569; line-height: 1.6;"><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on Lead Tracker.</p>
      <p style="color: #475569; line-height: 1.6;">Register with this email address (<strong>${toEmail}</strong>) to get started:</p>
      ${buttonHtml('Register Now', registerUrl)}
      <p style="color: #94a3b8; font-size: 13px;">If the button doesn't work, copy and paste this link: <a href="${registerUrl}" style="color: #2563eb;">${registerUrl}</a></p>
    `)
  );
}

async function sendTrackerInviteEmail(toEmail, trackerName, inviterName) {
  const registerUrl = `${config.appBaseUrl}/register`;
  return sendEmail(
    toEmail,
    `You've been invited to tracker "${trackerName}"`,
    emailWrapper(`
      <h2 style="color: #1e293b; font-size: 20px; margin: 0 0 16px;">Tracker Invitation</h2>
      <p style="color: #475569; line-height: 1.6;"><strong>${inviterName}</strong> has invited you to the tracker <strong>"${trackerName}"</strong> on Lead Tracker.</p>
      <p style="color: #475569; line-height: 1.6;">Register or sign in with <strong>${toEmail}</strong> to access it:</p>
      ${buttonHtml('Get Started', registerUrl)}
    `)
  );
}

async function sendMemberAddedEmail(toEmail, trackerName, role, addedByName) {
  const appUrl = config.appBaseUrl;
  return sendEmail(
    toEmail,
    `You've been added to "${trackerName}"`,
    emailWrapper(`
      <h2 style="color: #1e293b; font-size: 20px; margin: 0 0 16px;">You're In!</h2>
      <p style="color: #475569; line-height: 1.6;"><strong>${addedByName}</strong> added you to the tracker <strong>"${trackerName}"</strong> as <strong>${role}</strong>.</p>
      <p style="color: #475569; line-height: 1.6;">You can now access leads and start working.</p>
      ${buttonHtml('Open Lead Tracker', appUrl)}
    `)
  );
}

async function sendTrackerDeletedEmail(toEmail, trackerName, deletedByName) {
  return sendEmail(
    toEmail,
    `Tracker "${trackerName}" has been archived`,
    emailWrapper(`
      <h2 style="color: #1e293b; font-size: 20px; margin: 0 0 16px;">Tracker Archived</h2>
      <p style="color: #475569; line-height: 1.6;">The tracker <strong>"${trackerName}"</strong> has been archived by <strong>${deletedByName}</strong>.</p>
      <p style="color: #475569; line-height: 1.6;">It will be retained for <strong>90 days</strong> and can be restored by an org admin. After 90 days, it will be permanently deleted.</p>
    `)
  );
}

async function sendPasswordResetEmail(toEmail, resetToken) {
  const resetUrl = `${config.appBaseUrl}/reset-password?token=${resetToken}`;
  return sendEmail(
    toEmail,
    'Reset Your Password — Lead Tracker',
    emailWrapper(`
      <h2 style="color: #1e293b; font-size: 20px; margin: 0 0 16px;">Password Reset</h2>
      <p style="color: #475569; line-height: 1.6;">We received a request to reset your password. Click the button below to set a new one:</p>
      ${buttonHtml('Reset Password', resetUrl)}
      <p style="color: #94a3b8; font-size: 13px;">This link expires in <strong>1 hour</strong>. If you didn't request this, you can safely ignore this email.</p>
      <p style="color: #94a3b8; font-size: 13px;">Or copy this link: <a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a></p>
    `)
  );
}

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendInviteEmail,
  sendTrackerInviteEmail,
  sendMemberAddedEmail,
  sendTrackerDeletedEmail,
  sendPasswordResetEmail,
};
