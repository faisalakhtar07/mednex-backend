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
    // 'customer' = patient booking appointments, 'doctor' = a doctor who has
    // registered on MedNex (subscription-gated visibility), 'doctor_staff' =
    // staff working under one doctor (confirms/manages appointments and the
    // token queue on that doctor's behalf), 'admin' = platform-level Super
    // Admin.
    //
    // NOTE: the earlier medical-store marketplace roles ('owner', 'delivery')
    // and everything tied to them (MedicalStore, Product, Order, delivery
    // fleet) have been removed — MedNex is now a Doctor Appointment platform.
    role: { type: String, enum: ['customer', 'doctor', 'doctor_staff', 'admin'], default: 'customer', index: true },
    // Kept for backward compatibility with the earlier single-pharmacy admin dashboard.
    // New code should check role === 'admin' instead; this stays in sync automatically.
    isAdmin: { type: Boolean, default: false },
    // Which doctor this account belongs to. Required for 'doctor_staff'
    // always (a staff member belongs to exactly one doctor/clinic). Also set
    // on the 'doctor' role's own user record once their DoctorProfile is
    // created, so `req.user.doctorId` works the same way for both roles when
    // checking dashboard/queue access. Null for customers and admin.
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorProfile', default: null, index: true },
    active: { type: Boolean, default: true }, // admin or the owning doctor can deactivate a staff account
    addresses: [addressSchema],
    // Doctors a customer has bookmarked (heart icon on DoctorCard/DoctorDetail)
    // — see routes/favoriteRoutes.js. Only meaningful for role 'customer'.
    favoriteDoctors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DoctorProfile' }],
    // Email-based password reset (routes/authRoutes.js: /password/forgot +
    // /password/reset). We store a SHA-256 hash of the reset token, never
    // the token itself — same pattern as a password hash, so a DB leak
    // alone can't be used to reset accounts. Token is single-use and
    // expires after 15 minutes.
    resetPasswordTokenHash: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null, select: false },
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
  if (this.role === 'doctor_staff' && !this.doctorId) {
    return next(new Error('Doctor staff accounts require a doctorId'))
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
