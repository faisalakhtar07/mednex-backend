import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: 'Home' },
    fullName: String,
    mobile: String,
    house: String,
    street: String,
    area: String,
    city: String,
    state: String,
    pin: String,
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
)

const userSchema = new mongoose.Schema(
  {
    // Optional for customers who signed up purely by OTP and never typed a
    // name — the frontend prompts them to complete their profile afterward.
    // Still required for staff accounts (set at /api/staff/register).
    name: { type: String, trim: true, default: '' },
    // Customers authenticate with mobile number + password only (OTP
    // removed entirely per product decision) — mobile is required and
    // unique; email is optional (a customer can add it later from account
    // settings, but it's never used for login).
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    mobile: { type: String, unique: true, sparse: true, trim: true, required: true },
    // Required for every role now that OTP is gone — a customer sets their
    // own password at signup, there's no OTP-only account state anymore.
    password: { type: String, required: true, minlength: 6 },
    // 'customer' = shopper, 'owner' = medical store owner, 'delivery' = MedNex
    // platform-wide delivery rider (NOT tied to a store — see deliveryProfile
    // below), 'admin' = platform-level Super Admin (section 14).
    role: { type: String, enum: ['customer', 'owner', 'delivery', 'admin'], default: 'customer', index: true },
    // Kept for backward compatibility with the earlier single-pharmacy admin dashboard.
    // New code should check role === 'admin' instead; this stays in sync automatically.
    isAdmin: { type: Boolean, default: false },
    // Which store this account belongs to. Required for 'owner' always, and
    // for 'delivery' when deliveryScope === 'store' (an owner's own rider —
    // see deliveryScope below). Null for platform-wide riders, customers,
    // and admin.
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalStore', default: null, index: true },
    active: { type: Boolean, default: true }, // admin (platform riders) or owner (store riders) can deactivate
    addresses: [addressSchema],

    // Only populated for role === 'delivery'. MedNex now supports TWO kinds
    // of delivery rider (spec: "Owner Delivery + MedNex Delivery"):
    //  - deliveryScope 'platform': MedNex's own shared fleet. Self-registers,
    //    gated by Super Admin verification, participates in the
    //    broadcast-and-claim assignment system (see DeliveryAssignment).
    //  - deliveryScope 'store': one store's own rider, created directly by
    //    that store's owner (POST /api/owner/delivery-staff) — never part of
    //    the broadcast pool, only ever receives orders that owner assigns
    //    them to directly. storeId is required for this scope.
    deliveryProfile: {
      scope: { type: String, enum: ['platform', 'store'], default: 'platform' },
      profilePhoto: { type: String, default: '' },
      // Store-scoped riders are the owner's own hire — the owner vouches for
      // them, not Super Admin, so they're auto-approved and skip the
      // platform verification queue entirely.
      verificationStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      verificationDocs: [{ label: String, url: String }],
      // Whether this rider is currently open to receiving new assignments —
      // toggled by the rider themselves from their dashboard. Only
      // meaningful for platform riders (store riders are assigned directly
      // by their owner, not via the online/claim pool).
      availability: { type: String, enum: ['online', 'offline'], default: 'offline' },
      currentLocation: { lat: Number, lng: Number, updatedAt: Date },
      bankDetails: {
        accountHolder: String,
        accountNumber: String,
        ifsc: String,
        upiId: String,
      },
      // Denormalized running totals, updated whenever a DeliveryAssignment
      // completes or a DeliveryPayout is processed — kept here so the
      // rider's own dashboard stats load in one query instead of aggregating
      // every assignment/payout on every page view. Store-scoped riders
      // don't get platform payouts (their owner pays them directly — spec
      // section 11), so these stay at 0 for that scope.
      totalDeliveries: { type: Number, default: 0 },
      totalEarnings: { type: Number, default: 0 }, // lifetime, all completed deliveries
      pendingPayout: { type: Number, default: 0 }, // earned but not yet paid out
      paidAmount: { type: Number, default: 0 }, // lifetime, already paid out
    },
  },
  { timestamps: true }
)

userSchema.pre('validate', function (next) {
  if (!this.mobile) {
    return next(new Error('Mobile number is required'))
  }
  if (this.role !== 'customer' && !this.email) {
    return next(new Error('Staff accounts require an email address'))
  }
  if (this.role === 'delivery' && this.deliveryProfile?.scope === 'store' && !this.storeId) {
    return next(new Error('Store-scoped delivery riders require a storeId'))
  }
  next()
})

userSchema.pre('save', async function (next) {
  if (this.isModified('role')) {
    this.isAdmin = this.role === 'admin'
  }
  if (!this.isModified('password')) return next()
  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
  next()
})

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password)
}

export default mongoose.model('User', userSchema)
