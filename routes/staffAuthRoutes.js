import express from 'express'
import User from '../models/User.js'
import { protect, requireRole, generateToken } from '../middleware/auth.js'

const router = express.Router()

// POST /api/staff/register — create a medical-store OWNER or a platform
// delivery RIDER account.
//
// Owner: no access code anymore — self-service, so any medical store can
// sign up and start a subscription immediately without the platform owner
// having to hand out/manage a shared secret per store. The account has no
// store yet — the owner completes store registration separately via
// POST /api/stores (spec section 5), and the store stays invisible to
// customers until BOTH Super Admin approves it AND its subscription payment
// clears (paid directly into MedNex's own Razorpay account — see
// paymentRoutes.js's subscription flow) — those two gates are what replace
// the access code as the actual control point, not a shared secret.
//
// Delivery: also no access code. MedNex now runs its own platform-wide
// delivery fleet (not tied to any one store, per the current spec), so
// there's no per-store isolation concern that a shared code could break —
// the actual gate is deliveryProfile.verificationStatus, which starts
// 'pending' and must be set to 'approved' by Super Admin (spec section 7)
// before the rider can go online and receive assignments — enforced in
// deliveryRoutes.js's /availability route, not here.
router.post('/register', async (req, res) => {
  try {
    const { name, email, mobile, password, role } = req.body
    if (!['owner', 'delivery'].includes(role)) {
      return res.status(400).json({ message: 'role must be owner or delivery' })
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
      deliveryProfile: user.deliveryProfile,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/staff/login — owner or delivery login, email/password only.
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body
    if (!['owner', 'delivery'].includes(role)) {
      return res.status(400).json({ message: 'Role must be owner or delivery' })
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
      storeId: user.storeId,
      deliveryProfile: user.deliveryProfile,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
