import nodemailer from 'nodemailer'

// SMTP transporter for transactional email — currently only the password
// reset link (routes/authRoutes.js: /password/forgot). Works with any SMTP
// provider (Gmail, SendGrid, Mailgun, Brevo, etc.) — just set these in
// .env:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_SECURE=false          (true only for port 465)
//   SMTP_USER=your@gmail.com
//   SMTP_PASS=your-16-char-app-password   (Gmail: NOT your normal password —
//                                           see the note in .env.example)
//   SMTP_FROM_EMAIL=your@gmail.com
//   SMTP_FROM_NAME=MedNex
let transporter = null

function getTransporter() {
  if (transporter) return transporter
  if (!isEmailConfigured()) return null
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true = port 465 (implicit TLS), false = port 587 (STARTTLS)
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  return transporter
}

export function isEmailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

// sendEmail({ to, subject, html }) — throws if SMTP isn't configured or the
// send fails, so callers can decide how to handle it (routes/authRoutes.js
// swallows the error into a generic response so it never leaks whether an
// email address exists).
export async function sendEmail({ to, subject, html }) {
  const t = getTransporter()
  if (!t) throw new Error('SMTP is not configured on the server')
  const fromName = process.env.SMTP_FROM_NAME || 'MedNex'
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER
  await t.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, html })
}
