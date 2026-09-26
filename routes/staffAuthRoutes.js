import express from 'express'
import User from '../models/User.js'
import { protect, requireRole, generateToken } from '../middleware/auth.js'

const router = express.Router()

// POST /api/staff/register — create a DOCTOR account (a doctor's own
// registration, before they've created their DoctorProfile — see
// doctorRoutes.js for that step) or a DOCTOR_STAFF account (created by a
// doctor/staff member that's already logged in, not self-service).
//
// Doctor: no access code — self-service, so any doctor can sign up and
// start the registration + subscription flow immediately. The account has
// no DoctorProfile yet — that's completed separately via the doctor
// registration form (spec section 3), and the doctor stays invisible to
// customer search until BOTH Super Admin approves the profile AND the
// subscription payment clears — those two gates are the actual control
// point, not a shared secret.
router.post('/register', async (req, res) => {
  try {
    const { name, email, mobile, password, role } = req.body
    if (role !== 'doctor') {
      return res.status(400).json({ message: 'role must be doctor (doctor_staff accounts are created from the doctor/staff dashboard, not here)' })
    }
    if (!name || !mobile || !password) {
      return res.status(400).json({ message: 'name, mobile, and password are required' })
    }
    const exists = await User.findOne({ $or: [{ email: email?.toLowerCase() }, { mobile }] })
    if (exists) return res.status(409).json({ message: 'An account with this email or mobile already exists' })

    const user = await User.create({ name, email, mobile, password, role })

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/staff/login — doctor or doctor_staff login, email/password only.
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body
    if (!['doctor', 'doctor_staff'].includes(role)) {
      return res.status(400).json({ message: 'Role must be doctor or doctor_staff' })
    }
    const user = await User.findOne({ email: email?.toLowerCase(), role })
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }
    if (user.active === false) {
      return res.status(403).json({ message: 'This account has been deactivated' })
    }
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      doctorId: user.doctorId,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/staff/add — a logged-in doctor (or authorized doctor_staff, per
// spec section 17) creates a new doctor_staff account under their own
// doctorId. Never self-service — this is the "doctor can add staff, staff
// can add staff" flow, enforced on the backend via req.user.doctorId /
// req.doctor, not just hidden on the frontend.
router.post('/add', protect, requireRole('doctor', 'doctor_staff'), async (req, res) => {
  try {
    const { name, email, mobile, password } = req.body
    if (!name || !email || !mobile || !password) {
      return res.status(400).json({ message: 'name, email, mobile, and password are required' })
    }
    const doctorId = req.user.role === 'doctor' ? req.user.doctorId : req.user.doctorId
    if (!doctorId) {
      return res.status(400).json({ message: 'Complete doctor registration before adding staff' })
    }
    const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { mobile }] })
    if (exists) return res.status(409).json({ message: 'An account with this email or mobile already exists' })

    const staff = await User.create({ name, email, mobile, password, role: 'doctor_staff', doctorId })
    res.status(201).json({ _id: staff._id, name: staff.name, email: staff.email, mobile: staff.mobile, active: staff.active })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/staff/mine — list staff belonging to the logged-in doctor.
router.get('/mine', protect, requireRole('doctor', 'doctor_staff'), async (req, res) => {
  if (!req.user.doctorId) return res.status(400).json({ message: 'Complete doctor registration first' })
  const staff = await User.find({ role: 'doctor_staff', doctorId: req.user.doctorId }).select('-password')
  res.json(staff)
})

// PUT /api/staff/:id/active — enable/disable one staff account. Backend
// checks the target belongs to the SAME doctorId as the caller — never
// trust a doctorId sent from the frontend for this (spec section 15: "Doctor
// A must NEVER be able to access Doctor B's staff").
router.put('/:id/active', protect, requireRole('doctor', 'doctor_staff'), async (req, res) => {
  const staff = await User.findOne({ _id: req.params.id, role: 'doctor_staff', doctorId: req.user.doctorId })
  if (!staff) return res.status(404).json({ message: 'Staff not found' })
  staff.active = req.body.active
  await staff.save()
  res.json({ _id: staff._id, active: staff.active })
})

export default router
