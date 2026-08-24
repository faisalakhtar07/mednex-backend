import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const statusHistorySchema = new mongoose.Schema({ status: String, at: { type: Date, default: Date.now } }, { _id: false })

// One DeliveryAssignment per confirmed order. This is the platform's own
// granular delivery workflow (spec section 8) — deliberately separate from
// Order.status, which stays a simple high-level view for customers/owners.
// A rider is assigned here regardless of which store the order came from,
// which is the core change from the old store-owned-delivery model.
const deliveryAssignmentSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalStore', required: true, index: true },
    deliveryBoyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    // Which delivery system fulfils this order — set once at confirm time
    // from the store's MedicalStore.deliveryMode and frozen here even if the
    // store changes its mode later (spec section 8: dual delivery system).
    // 'mednex' assignments go through the broadcast/claim flow below;
    // 'own' assignments are assigned directly to one of the store's own
    // delivery staff and never enter the broadcast pool.
    mode: { type: String, enum: ['mednex', 'own'], required: true },

    status: {
      type: String,
      enum: [
        'Broadcasting', // mednex mode only — visible to every online+approved rider, first to claim gets it
        'Unassigned', // own mode only — confirmed but no store rider available/assigned yet
        'Assigned', // rider assigned (claimed, or picked by admin/owner), awaiting their acceptance
        'Accepted',
        'Going to Store',
        'Reached Store',
        'Picked Up', // only reachable after a correct pickup-code verification
        'Going to Customer',
        'Reached Customer',
        'Delivered',
        'Cancelled',
      ],
      default: 'Unassigned',
      index: true,
    },
    statusHistory: [statusHistorySchema],

    // --- Store pickup security code (spec section 6) ---
    // Never store the plain code — same hashing approach as Otp.js. The
    // store owner reads the plain code to the rider out loud / shows it on
    // screen; only the hash is ever persisted, and it's never included in
    // any API response after creation.
    pickupCodeHash: { type: String, required: true, select: false },
    pickupVerifiedAt: { type: Date, default: null },
    pickupAttempts: { type: Number, default: 0 }, // basic brute-force guard, reset is not needed — assignment is one-shot

    broadcastAt: { type: Date, default: null }, // mednex mode: when it went out to the rider pool
    assignedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },

    // --- Fee/earning snapshot, computed once at assignment time from
    // AdminSettings so later admin rate changes never alter a delivery
    // that's already in progress or completed (spec section 39: never
    // recalculate settlement retroactively). ---
    distanceKm: { type: Number, default: null }, // optional — map integration can populate this later
    deliveryFee: { type: Number, required: true }, // what the customer was charged (0 if free-delivery threshold met)
    // What a MedNex-fleet rider earns for this delivery. Always 0 for
    // 'own' mode — the store pays its own rider directly, outside
    // MedNex's payout system entirely (spec section 11).
    deliveryBoyEarning: { type: Number, required: true },
  },
  { timestamps: true }
)

deliveryAssignmentSchema.pre('save', function (next) {
  if (this.isModified('status')) this.statusHistory.push({ status: this.status, at: new Date() })
  next()
})

deliveryAssignmentSchema.index({ deliveryBoyId: 1, status: 1 })
deliveryAssignmentSchema.index({ mode: 1, status: 1 }) // powers the broadcast-pool query (mode: 'mednex', status: 'Broadcasting')

// Generates a fresh 4-digit pickup code, hashes it for storage, and returns
// the PLAIN code once — the only time it's ever available in memory. Callers
// (the order-confirm route) must hand the plain code back to the store owner
// in that single response and never log or re-derive it afterward.
deliveryAssignmentSchema.statics.generatePickupCode = async function () {
  const plain = String(crypto.randomInt(1000, 10000))
  const hash = await bcrypt.hash(plain, 10)
  return { plain, hash }
}

deliveryAssignmentSchema.methods.verifyPickupCode = async function (candidate) {
  const doc = await mongoose.model('DeliveryAssignment').findById(this._id).select('+pickupCodeHash')
  return bcrypt.compare(String(candidate || ''), doc.pickupCodeHash)
}

// Atomically claims a broadcasting assignment for one rider — first request
// to reach MongoDB wins, full stop. The condition (status: 'Broadcasting',
// deliveryBoyId: null) is checked and updated in the SAME atomic operation,
// so two riders tapping "Accept" at the same instant can never both
// succeed — the second one's findOneAndUpdate simply matches zero documents
// and returns null. This is the race-condition safety the broadcast/claim
// model depends on (spec section 8: "sabse pehle confirm kare use mile").
deliveryAssignmentSchema.statics.claimBroadcast = async function (assignmentId, riderId) {
  return this.findOneAndUpdate(
    { _id: assignmentId, mode: 'mednex', status: 'Broadcasting', deliveryBoyId: null },
    { $set: { deliveryBoyId: riderId, status: 'Assigned', assignedAt: new Date() }, $push: { statusHistory: { status: 'Assigned', at: new Date() } } },
    { new: true }
  )
}

export default mongoose.model('DeliveryAssignment', deliveryAssignmentSchema)
