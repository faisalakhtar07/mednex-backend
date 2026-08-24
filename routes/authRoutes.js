import express from 'express'
import User from '../models/User.js'
import { protect, generateToken } from '../middleware/auth.js'
import { normalizeIdentifier } from '../utils/validators.js'

const router = express.Router()

function authResponse(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    isAdmin: user.isAdmin,
    token: generateToken(user._id),
  }
}

// --- Mobile number + password auth (OTP removed entirely per product
// decision — customers now sign up with just a mobile number and a
// password they create themselves, no SMS/email verification step at all). ---

// POST /api/auth/register { name, mobile, password, email? }
router.post('/register', async (req, res) => {
  try {
    const { name, mobile, password, email } = req.body
    if (!name || !mobile || !password) {
      return res.status(400).json({ message: 'Name, mobile number, and password are required' })
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }
    const normalizedMobile = normalizeIdentifier(mobile, 'mobile')
    const normalizedEmail = email ? normalizeIdentifier(email, 'email') : undefined

    const exists = await User.findOne({ mobile: normalizedMobile })
    if (exists) return res.status(409).json({ message: 'An account with this mobile number already exists' })

    // Customers can NEVER become owner/admin through normal signup — that
    // path is only via /api/staff/register with a valid access code.
    const user = await User.create({ name, mobile: normalizedMobile, email: normalizedEmail, password, isAdmin: false, role: 'customer' })
    res.status(201).json(authResponse(user))
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message })
  }
})

// POST /api/auth/login { mobile, password } — customers AND admin both use
// this (admin is just a role on the same User model, no separate login
// mechanism — see mednex-admin's login page, which calls this exact route).
// Owner/delivery still use POST /api/staff/login instead — they're the only
// roles that keep a distinct staff-style flow.
router.post('/login', async (req, res) => {
  try {
    if (!req.body.mobile || !req.body.password) {
      return res.status(400).json({ message: 'Mobile number and password are required' })
    }
    const normalizedMobile = normalizeIdentifier(req.body.mobile, 'mobile')
    const user = await User.findOne({ mobile: normalizedMobile })
    if (!user || (user.role !== 'customer' && user.role !== 'admin') || !(await user.comparePassword(req.body.password))) {
      return res.status(401).json({ message: 'Invalid mobile number or password' })
    }
    res.json(authResponse(user))
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message })
  }
})

// --- Forgot password — NO verification step, by explicit product decision.
// A user enters their mobile number and immediately sets a new password.
// This is a deliberate simplification (no OTP anywhere in the app anymore)
// and it does trade away a real security property: anyone who knows a
// customer's mobile number can reset that account's password. There's no
// way to fully close that gap without reintroducing some form of
// verification (OTP, security question, etc.) — flagging this plainly here
// since it's a product/security tradeoff, not a bug.

// POST /api/auth/password/reset-direct { mobile, newPassword }
router.post('/password/reset-direct', async (req, res) => {
  try {
    const { mobile, newPassword } = req.body
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }
    const normalizedMobile = normalizeIdentifier(mobile, 'mobile')
    const user = await User.findOne({ mobile: normalizedMobile, role: 'customer' })
    if (!user) {
      // Same response whether or not the account exists, so this endpoint
      // can't be used to enumerate registered mobile numbers.
      return res.json({ message: 'If an account exists for that number, the password has been updated.' })
    }
    user.password = newPassword
    await user.save()
    res.json({ message: 'If an account exists for that number, the password has been updated.' })
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message })
  }
})

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  res.json(req.user)
})

// PUT /api/auth/profile — update name and/or add an email address.
router.put('/profile', protect, async (req, res) => {
  try {
    if (req.body.name !== undefined) req.user.name = req.body.name.trim()
    if (req.body.email) {
      req.user.email = normalizeIdentifier(req.body.email, 'email')
    }
    await req.user.save()
    res.json(req.user)
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message })
  }
})

// PUT /api/auth/password — change password while logged in (account settings).
router.put('/password', protect, async (req, res) => {
  try {
    if (!req.body.newPassword || req.body.newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' })
    }
    if (req.user.password) {
      if (!req.body.currentPassword || !(await req.user.comparePassword(req.body.currentPassword))) {
        return res.status(401).json({ message: 'Current password is incorrect' })
      }
    }
    req.user.password = req.body.newPassword
    await req.user.save()
    res.json({ message: 'Password updated' })
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message })
  }
})

// POST /api/auth/addresses — add a saved delivery address
router.post('/addresses', protect, async (req, res) => {
  const isFirst = req.user.addresses.length === 0
  req.user.addresses.push({ ...req.body, isDefault: isFirst ? true : !!req.body.isDefault })
  if (req.body.isDefault) {
    req.user.addresses.forEach((a) => {
      if (a._id.toString() !== req.user.addresses[req.user.addresses.length - 1]._id.toString()) a.isDefault = false
    })
  }
  await req.user.save()
  res.status(201).json(req.user.addresses)
})

// GET /api/auth/addresses
router.get('/addresses', protect, async (req, res) => {
  res.json(req.user.addresses)
})

// PUT /api/auth/addresses/:addressId — edit an existing address
router.put('/addresses/:addressId', protect, async (req, res) => {
  const addr = req.user.addresses.id(req.params.addressId)
  if (!addr) return res.status(404).json({ message: 'Address not found' })
  Object.assign(addr, req.body)
  if (req.body.isDefault) {
    req.user.addresses.forEach((a) => {
      a.isDefault = a._id.toString() === req.params.addressId
    })
  }
  await req.user.save()
  res.json(req.user.addresses)
})

// DELETE /api/auth/addresses/:addressId
router.delete('/addresses/:addressId', protect, async (req, res) => {
  const addr = req.user.addresses.id(req.params.addressId)
  if (!addr) return res.status(404).json({ message: 'Address not found' })
  const wasDefault = addr.isDefault
  addr.deleteOne()
  if (wasDefault && req.user.addresses.length > 0) {
    req.user.addresses[0].isDefault = true
  }
  await req.user.save()
  res.json(req.user.addresses)
})

// PUT /api/auth/addresses/:addressId/default — mark one address as the default
router.put('/addresses/:addressId/default', protect, async (req, res) => {
  const found = req.user.addresses.id(req.params.addressId)
  if (!found) return res.status(404).json({ message: 'Address not found' })
  req.user.addresses.forEach((a) => {
    a.isDefault = a._id.toString() === req.params.addressId
  })
  await req.user.save()
  res.json(req.user.addresses)
})

export default router
