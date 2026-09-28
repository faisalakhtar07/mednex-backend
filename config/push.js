import webpush from 'web-push'

// Browser push notifications (Web Push API) via VAPID — set these in .env:
//   VAPID_PUBLIC_KEY=...
//   VAPID_PRIVATE_KEY=...
//   VAPID_CONTACT_EMAIL=mailto:you@example.com
// Generate a fresh keypair anytime with: npx web-push generate-vapid-keys
let configured = false

export function isPushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

function ensureConfigured() {
  if (configured || !isPushConfigured()) return
  webpush.setVapidDetails(
    process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
  configured = true
}

ensureConfigured()

export default webpush