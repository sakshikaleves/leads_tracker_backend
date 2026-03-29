const nodemailer = require('nodemailer');
const config = require('../config/env');

let transporter = null;

function getTransporter() {
  if (!transporter && config.smtp.host && config.smtp.user) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }
  return transporter;
}

async function sendWelcomeEmail(toEmail, orgName) {
  try {
    const transport = getTransporter();
    if (!transport) {
      console.log('[Email] SMTP not configured, skipping welcome email to', toEmail);
      return;
    }

    const registerUrl = `${config.appBaseUrl}/register`;

    await transport.sendMail({
      from: config.smtp.from,
      to: toEmail,
      subject: `You've been invited as Admin of ${orgName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a1a;">Welcome to Lead Tracker!</h2>
          <p>You have been added as an <strong>Organization Admin</strong> for <strong>${orgName}</strong>.</p>
          <p>To get started, create your account using this email address (<strong>${toEmail}</strong>):</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${registerUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Register Now
            </a>
          </div>
          <p style="color: #666;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="color: #2563eb; word-break: break-all;">${registerUrl}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">This email was sent by Lead Tracker. If you did not expect this, you can ignore it.</p>
        </div>
      `,
    });

    console.log('[Email] Welcome email sent to', toEmail);
  } catch (err) {
    console.error('[Email] Failed to send welcome email to', toEmail, err.message);
  }
}

async function sendInviteEmail(toEmail, orgName, inviterName) {
  try {
    const transport = getTransporter();
    if (!transport) {
      console.log('[Email] SMTP not configured, skipping invite email to', toEmail);
      return;
    }

    const registerUrl = `${config.appBaseUrl}/register`;

    await transport.sendMail({
      from: config.smtp.from,
      to: toEmail,
      subject: `You've been invited to join ${orgName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1a1a1a;">You're Invited!</h2>
          <p><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on Lead Tracker.</p>
          <p>Register with this email address (<strong>${toEmail}</strong>) to get started:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${registerUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Register Now
            </a>
          </div>
          <p style="color: #666;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="color: #2563eb; word-break: break-all;">${registerUrl}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">This email was sent by Lead Tracker. If you did not expect this, you can ignore it.</p>
        </div>
      `,
    });

    console.log('[Email] Invite email sent to', toEmail);
  } catch (err) {
    console.error('[Email] Failed to send invite email to', toEmail, err.message);
  }
}

module.exports = { sendWelcomeEmail, sendInviteEmail };
