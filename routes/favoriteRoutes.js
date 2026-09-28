import express from 'express'
import User from '../models/User.js'
import DoctorProfile from '../models/DoctorProfile.js'
import { protect, requireRole } from '../middleware/auth.js'

const router = express.Router()

// GET /api/favorites/mine — the logged-in patient's saved doctors, newest-saved first isn't
// tracked separately, so this returns them in whatever order they sit in the array (append order).
router.get('/mine', protect, requireRole('customer'), async (req, res) => {
  const doctors = await DoctorProfile.find({ _id: { $in: req.user.favoriteDoctors } })
  res.json(doctors)
})

// GET /api/favorites/ids — just the doctor IDs, lightweight, for the frontend
// to know which hearts to fill in on a search results page without fetching
// full doctor docs again.
router.get('/ids', protect, requireRole('customer'), async (req, res) => {
  res.json(req.user.favoriteDoctors.map(String))
})

// POST /api/favorites/:doctorId — toggle: adds if not already saved, removes if it is.
// Returns the new state so the frontend doesn't need a separate GET to sync the heart icon.
router.post('/:doctorId', protect, requireRole('customer'), async (req, res) => {
  const { doctorId } = req.params
  const doctor = await DoctorProfile.findById(doctorId)
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' })

  const isFavorited = req.user.favoriteDoctors.some((id) => String(id) === doctorId)
  if (isFavorited) {
    req.user.favoriteDoctors = req.user.favoriteDoctors.filter((id) => String(id) !== doctorId)
  } else {
    req.user.favoriteDoctors.push(doctorId)
  }
  await req.user.save()
  res.json({ favorited: !isFavorited })
})

export default router
