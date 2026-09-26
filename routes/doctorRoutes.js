import express from 'express'
import DoctorProfile from '../models/DoctorProfile.js'
import Appointment from '../models/Appointment.js'
import { protect, requireRole, optionalAuth } from '../middleware/auth.js'
import { upload } from '../middleware/upload.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured } from '../config/cloudinary.js'

const router = express.Router()

// Customer-facing doctor search + profile, plus doctor's own
// registration/profile-edit endpoints (all doctor-tenant scoped resources
// live here; appointment booking/management is in appointmentRoutes.js and
// doctorDashboardRoutes.js).

/* ---------- Public search ---------- */

// GET /api/doctors?specialization=&city=&pincode=&q=
// Only returns doctors eligible for the marketplace (approved + active
// subscription + available) — a rejected/expired/unsubscribed doctor never
// shows up here no matter what filters are passed.
router.get('/', async (req, res) => {
  const { specialization, city, pincode, q } = req.query
  const filter = DoctorProfile.marketplaceEligibleFilter()
  if (specialization) filter.specialization = specialization
  if (city) filter.city = new RegExp(`^${city}$`, 'i')
  if (pincode) filter.pincode = pincode
  if (q) filter.$text = { $search: q }
  const doctors = await DoctorProfile.find(filter).sort(q ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
  res.json(doctors)
})

// GET /api/doctors/:id — public detail. optionalAuth so the doctor viewing
// their own not-yet-approved profile still sees it; everyone else only sees
// it once it's marketplace-eligible.
router.get('/:id', optionalAuth, async (req, res) => {
  const doctor = await DoctorProfile.findById(req.params.id)
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' })
  const isOwner = req.user && String(doctor.userId) === String(req.user._id)
  const isAdmin = req.user?.role === 'admin' || req.user?.isAdmin
  if (!doctor.isMarketplaceEligible() && !isOwner && !isAdmin) {
    return res.status(404).json({ message: 'Doctor not found' })
  }
  res.json(doctor)
})

/* ---------- Doctor's own profile ---------- */

// POST /api/doctors/register — the logged-in 'doctor' account creates their
// ONE profile. Never editable into existence a second time — that's what
// PUT /mine is for.
router.post('/register', protect, requireRole('doctor'), async (req, res) => {
  try {
    const existing = await DoctorProfile.findOne({ userId: req.user._id })
    if (existing) return res.status(409).json({ message: 'You have already registered a doctor profile' })

    const { name, photo, qualification, specialization, experience, description, phone, email, clinicName, clinicAddress, city, state, pincode, consultationFee, availableDays, availableTime } = req.body
    if (!name || !specialization || !phone || !city || consultationFee == null) {
      return res.status(400).json({ message: 'name, specialization, phone, city, and consultationFee are required' })
    }

    const doctor = await DoctorProfile.create({
      userId: req.user._id,
      name, photo, qualification, specialization, experience, description, phone,
      email: email || req.user.email,
      clinicName, clinicAddress, city, state, pincode,
      consultationFee, availableDays, availableTime,
    })

    // Link the account to its profile so req.user.doctorId works everywhere
    // else immediately (staff creation, dashboard access) without a re-login.
    req.user.doctorId = doctor._id
    await req.user.save()

    res.status(201).json(doctor)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/mine/profile', protect, requireRole('doctor'), async (req, res) => {
  const doctor = await DoctorProfile.findOne({ userId: req.user._id })
  if (!doctor) return res.status(404).json({ message: 'No doctor profile yet — register first' })
  res.json(doctor)
})

// Editing does NOT reset verificationStatus back to pending — small profile
// tweaks (fee, hours) shouldn't force a re-review. Admin can still see edit
// history isn't tracked here; that's a fine tradeoff for v1.
router.put('/mine/profile', protect, requireRole('doctor'), async (req, res) => {
  const doctor = await DoctorProfile.findOne({ userId: req.user._id })
  if (!doctor) return res.status(404).json({ message: 'No doctor profile yet — register first' })
  const editable = ['name', 'photo', 'qualification', 'specialization', 'experience', 'description', 'phone', 'email', 'clinicName', 'clinicAddress', 'city', 'state', 'pincode', 'consultationFee', 'availableDays', 'availableTime', 'isAvailable']
  for (const key of editable) {
    if (req.body[key] !== undefined) doctor[key] = req.body[key]
  }
  await doctor.save()
  res.json(doctor)
})

// PUT /api/doctors/mine/qr-code — optional payment QR upload (spec: never forced)
router.put('/mine/qr-code', protect, requireRole('doctor'), upload.single('file'), async (req, res) => {
  try {
    const doctor = await DoctorProfile.findOne({ userId: req.user._id })
    if (!doctor) return res.status(404).json({ message: 'No doctor profile yet — register first' })
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({ message: 'File storage is not configured yet on the server.' })
    }
    const result = await uploadBufferToCloudinary(req.file.buffer, { folder: 'mednex/doctor-qr' })
    doctor.qrCodeUrl = result.secure_url
    await doctor.save()
    res.json(doctor)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/doctors/queue/:doctorId/today — public, lightweight poll target
// for the patient-facing "live queue" view. Returns just the current
// serving token for TODAY, reset-aware (see doctorDashboardRoutes.js for
// where the reset actually happens — this endpoint only reads).
router.get('/queue/:doctorId/today', async (req, res) => {
  const doctor = await DoctorProfile.findById(req.params.doctorId)
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' })
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const isToday = doctor.currentServingDate && new Date(doctor.currentServingDate).getTime() === todayStart.getTime()
  const totalToday = await Appointment.countDocuments({ doctorId: doctor._id, date: todayStart, status: 'confirmed' })
  res.json({ currentServingToken: isToday ? doctor.currentServingToken : 0, totalConfirmedToday: totalToday })
})

export default router
