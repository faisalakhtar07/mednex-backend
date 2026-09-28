import express from 'express'
import Review from '../models/Review.js'
import Appointment from '../models/Appointment.js'
import DoctorProfile from '../models/DoctorProfile.js'
import { protect, requireRole } from '../middleware/auth.js'

const router = express.Router()

// POST /api/reviews { appointmentId, rating, comment }
// Only the patient who had that appointment can review it, only once it's
// 'completed', and only once ever (unique index on appointmentId backs this
// up at the DB level too, in case of a race between two tabs).
router.post('/', protect, requireRole('customer'), async (req, res) => {
  try {
    const { appointmentId, rating, comment } = req.body
    const ratingNum = Number(rating)
    if (!appointmentId || !ratingNum || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: 'appointmentId and a rating from 1 to 5 are required' })
    }
    const appointment = await Appointment.findOne({ _id: appointmentId, patientId: req.user._id })
    if (!appointment) return res.status(404).json({ message: 'Appointment not found' })
    if (appointment.status !== 'completed') {
      return res.status(400).json({ message: 'You can only review a completed appointment' })
    }
    if (appointment.reviewed) {
      return res.status(409).json({ message: 'You have already reviewed this appointment' })
    }

    const review = await Review.create({
      doctorId: appointment.doctorId,
      patientId: req.user._id,
      appointmentId: appointment._id,
      patientName: req.user.name || 'Patient',
      rating: ratingNum,
      comment: (comment || '').trim(),
    })

    appointment.reviewed = true
    await appointment.save()

    // Recompute the doctor's running average — small enough table per
    // doctor (a busy clinic's lifetime review count) that a full aggregate
    // on every new review is simpler and safer than trying to maintain a
    // running-average formula by hand.
    const stats = await Review.aggregate([
      { $match: { doctorId: appointment.doctorId } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ])
    await DoctorProfile.findByIdAndUpdate(appointment.doctorId, {
      ratingAvg: stats[0]?.avg || ratingNum,
      ratingCount: stats[0]?.count || 1,
    })

    res.status(201).json(review)
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'You have already reviewed this appointment' })
    res.status(500).json({ message: err.message })
  }
})

// GET /api/reviews/doctor/:doctorId?page=&limit= — public, paginated,
// newest first.
router.get('/doctor/:doctorId', async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1)
  const limit = Math.min(Number(req.query.limit) || 10, 30)
  const [reviews, total] = await Promise.all([
    Review.find({ doctorId: req.params.doctorId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Review.countDocuments({ doctorId: req.params.doctorId }),
  ])
  res.json({ reviews, total, page, hasMore: page * limit < total })
})

export default router
