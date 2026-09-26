import AuditLog from '../models/AuditLog.js'

// Fire-and-forget audit trail write. Deliberately never throws or blocks the
// calling route — an audit log failure should never break the actual admin
// action it's recording (spec section 32 asks for logging, not for it to
// become a new point of failure).
export async function logAdminAction(actor, action, targetType = '', targetId = null, details = {}) {
  try {
    await AuditLog.create({ actor, action, targetType, targetId, details })
  } catch (err) {
    console.error('Audit log write failed:', err.message)
  }
}
