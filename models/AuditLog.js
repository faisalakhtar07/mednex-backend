import mongoose from 'mongoose'

// Lightweight audit trail for admin-level actions (spec section 32) — store
// approval, subscription/commission changes, payouts, product/setting edits.
// Written via utils/audit.js's `logAdminAction`, never edited afterward.
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true, index: true }, // e.g. 'store.verify', 'settings.update', 'payout.process'
    targetType: { type: String, default: '' }, // e.g. 'MedicalStore', 'AdminSettings'
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: {} }, // small before/after snapshot, not the full document
  },
  { timestamps: true }
)

export default mongoose.model('AuditLog', auditLogSchema)
