const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_RE = /^[6-9]\d{9}$/ // 10-digit Indian mobile number

// Normalizes and validates a raw identifier for a given channel. Throws a
// user-facing Error (with `status`) on anything malformed, so route handlers
// can just `const identifier = normalizeIdentifier(...)` and trust the result.
export function normalizeIdentifier(raw, channel) {
  const value = String(raw || '').trim()
  if (channel === 'email') {
    const email = value.toLowerCase()
    if (!EMAIL_RE.test(email)) {
      const err = new Error('Enter a valid email address')
      err.status = 400
      throw err
    }
    return email
  }
  if (channel === 'mobile') {
    const mobile = value.replace(/^\+?91/, '').replace(/\D/g, '')
    if (!MOBILE_RE.test(mobile)) {
      const err = new Error('Enter a valid 10-digit mobile number')
      err.status = 400
      throw err
    }
    return mobile
  }
  const err = new Error("channel must be 'mobile' or 'email'")
  err.status = 400
  throw err
}
