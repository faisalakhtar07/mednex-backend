import mongoose from 'mongoose'

// A DoctorProfile is one doctor operating on MedNex. Every doctor-scoped
// resource (Appointment, TokenQueue, and User accounts with role
// 'doctor_staff') carries a `doctorId` pointing back here, and the doctor's
// own account is tied to exactly one profile via User.doctorId. This is the
// tenant boundary for the doctor platform — mirrors how MedicalStore used to
// be the tenant boundary for the old medical-store marketplace (now removed).
// See middleware/doctorAuth.js for how it's enforced on requests.
const doctorProfileSchema = new mongoose.Schema(
  {
    // --- Ownership ---
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // --- Identity ---
    name: { type: String, required: true, trim: true },
    photo: { type: String, default: '' },
    qualification: { type: String, default: '' },
    specialization: { type: String, required: true, index: true }, // e.g. Cardiologist, Dermatologist
    experience: { type: String, default: '' },
    description: { type: String, default: '' },
    phone: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },

    // --- Clinic / location ---
    clinicName: { type: String, default: '' },
    clinicAddress: { type: String, default: '' },
    city: { type: String, required: true, index: true },
    state: { type: String, default: '' },
    pincode: { type: String, index: true },

    // --- Consultation ---
    consultationFee: { type: Number, required: true },
    availableDays: [{ type: String }], // e.g. ['Mon','Tue','Wed']
    availableTime: { type: String, default: '' }, // e.g. "10:00 AM - 6:00 PM"

    // --- Payment QR (optional, per spec — never forced at registration) ---
    qrCodeUrl: { type: String, default: '' },

    // --- Platform gatekeeping (mirrors the old MedicalStore verification) ---
    verificationStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    verificationNote: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Denormalized from the doctor's current Subscription document so
    // customer search can filter with a single indexed field instead of a
    // join on every search. Kept in sync by subscriptionRoutes.js whenever
    // the Subscription changes.
    subscriptionStatus: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    activeSubscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null },

    // Doctor can pause visibility manually (on leave etc.) without touching
    // verification/subscription state.
    isAvailable: { type: Boolean, default: true },

    ratingAvg: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    // Once-per-doctor 15-day free trial (routes/subscriptionRoutes.js:
    // POST /start-free-trial). True the moment they start it, even if that
    // trial has since expired — so they can never start a second one.
    hasUsedFreeTrial: { type: Boolean, default: false },

    // --- Live token queue (spec: token-queue system, not fixed time slots) ---
    // "Whose turn is it right now" for TODAY only — reset automatically the
    // first time it's touched on a new calendar day (see
    // middleware/doctorAuth.js's helper is NOT used here; the reset check
    // lives directly in doctorDashboardRoutes.js's "call next" handler,
    // right where currentServingToken is mutated, so there's exactly one
    // place that can ever change it).
    currentServingToken: { type: Number, default: 0 },
    currentServingDate: { type: Date, default: null },
  },
  { timestamps: true }
)

doctorProfileSchema.index({ pincode: 1, specialization: 1, verificationStatus: 1, subscriptionStatus: 1 })
doctorProfileSchema.index({ name: 'text', specialization: 'text' })

// A doctor is eligible to appear in customer-facing search only when BOTH
// verification and subscription checks pass (spec section 3: doctors need
// an active subscription before becoming publicly available).
doctorProfileSchema.methods.isMarketplaceEligible = function () {
  return this.verificationStatus === 'approved' && this.subscriptionStatus === 'active' && this.isAvailable
}

doctorProfileSchema.statics.marketplaceEligibleFilter = function (extra = {}) {
  return { verificationStatus: 'approved', subscriptionStatus: 'active', isAvailable: true, ...extra }
}

export default mongoose.model('DoctorProfile', doctorProfileSchema)
