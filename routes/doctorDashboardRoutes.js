import express from 'express'
import Appointment from '../models/Appointment.js'
import DoctorProfile from '../models/DoctorProfile.js'
import Notification from '../models/Notification.js'
import { protect, requireRole } from '../middleware/auth.js'
import { attachDoctor, requireOwnedDoc } from '../middleware/doctorAuth.js'

const router = express.Router()
// Every route here is doctor-tenant-scoped: 'doctor' or 'doctor_staff' only,
// and attachDoctor puts the correct DoctorProfile on req.doctor for both —
// see middleware/doctorAuth.js for why this is the enforcement point, not
// just the frontend hiding buttons.
router.use(protect, requireRole('doctor', 'doctor_staff'), attachDoctor)

function midnight(dateInput) {
  const d = new Date(dateInput)
  d.setHours(0, 0, 0, 0)
  return d
}

// GET /api/doctor-dashboard/appointments?status=&date=
router.get('/appointments', async (req, res) => {
  const filter = { doctorId: req.doctor._id }
  if (req.query.status) filter.status = req.query.status
  if (req.query.date) filter.date = midnight(req.query.date)
  const appointments = await Appointment.find(filter).sort({ date: 1, tokenNumber: 1, createdAt: 1 })
  res.json(appointments)
})

// PUT /api/doctor-dashboard/appointments/:id/confirm — assigns the next
// token number FOR THAT DAY (contiguous per doctor per date, computed by
// counting existing confirmed bookings for the same day — race-safe enough
// for a single-clinic confirm rate; a high-volume clinic should move this to
// a proper atomic counter later).
router.put('/appointments/:id/confirm', async (req, res) => {
  const appointment = await requireOwnedDoc(Appointment, req.params.id, req.doctor._id, res)
  if (!appointment) return
  if (appointment.status !== 'requested') {
    return res.status(400).json({ message: `Cannot confirm an appointment that is already ${appointment.status}` })
  }
  const existingCount = await Appointment.countDocuments({ doctorId: req.doctor._id, date: appointment.date, status: { $in: ['confirmed', 'completed'] } })
  appointment.status = 'confirmed'
  appointment.tokenNumber = existingCount + 1
  appointment.confirmedBy = req.user._id
  await appointment.save()

  await Notification.create({
    user: appointment.patientId,
    title: 'Appointment Confirmed',
    message: `Your appointment with ${req.doctor.name} is confirmed — your token number is ${appointment.tokenNumber}.`,
    type: 'appointment_confirmed',
    relatedAppointment: appointment._id,
  })
  res.json(appointment)
})

router.put('/appointments/:id/reject', async (req, res) => {
  const appointment = await requireOwnedDoc(Appointment, req.params.id, req.doctor._id, res)
  if (!appointment) return
  if (appointment.status !== 'requested') {
    return res.status(400).json({ message: `Cannot reject an appointment that is already ${appointment.status}` })
  }
  appointment.status = 'rejected'
  appointment.rejectionReason = req.body.reason || ''
  appointment.confirmedBy = req.user._id
  await appointment.save()

  await Notification.create({
    user: appointment.patientId,
    title: 'Appointment Declined',
    message: `Your appointment request with ${req.doctor.name} was declined${appointment.rejectionReason ? `: ${appointment.rejectionReason}` : '.'}`,
    type: 'appointment_rejected',
    relatedAppointment: appointment._id,
  })
  res.json(appointment)
})

router.put('/appointments/:id/complete', async (req, res) => {
  const appointment = await requireOwnedDoc(Appointment, req.params.id, req.doctor._id, res)
  if (!appointment) return
  if (appointment.status !== 'confirmed') {
    return res.status(400).json({ message: 'Only a confirmed appointment can be marked completed' })
  }
  appointment.status = 'completed'
  await appointment.save()
  res.json(appointment)
})

router.put('/appointments/:id/no-show', async (req, res) => {
  const appointment = await requireOwnedDoc(Appointment, req.params.id, req.doctor._id, res)
  if (!appointment) return
  if (appointment.status !== 'confirmed') {
    return res.status(400).json({ message: 'Only a confirmed appointment can be marked no-show' })
  }
  appointment.status = 'no_show'
  await appointment.save()
  res.json(appointment)
})

/* ---------- Live token queue control ---------- */

// GET /api/doctor-dashboard/queue/today — today's confirmed queue + who's currently being served
router.get('/queue/today', async (req, res) => {
  const today = midnight(new Date())
  const resetIfNeeded = req.doctor.currentServingDate?.getTime() !== today.getTime()
  const currentServingToken = resetIfNeeded ? 0 : req.doctor.currentServingToken
  const queue = await Appointment.find({ doctorId: req.doctor._id, date: today, status: { $in: ['confirmed', 'completed', 'no_show'] } }).sort({ tokenNumber: 1 })
  res.json({ currentServingToken, queue })
})

// POST /api/doctor-dashboard/queue/call-next — advances the "now serving"
// token by one. This is the ONLY place currentServingToken/currentServingDate
// are ever written, and it resets them the first time it's called on a new
// calendar day — so yesterday's leftover count never bleeds into today.
router.post('/queue/call-next', async (req, res) => {
  const today = midnight(new Date())
  if (req.doctor.currentServingDate?.getTime() !== today.getTime()) {
    req.doctor.currentServingToken = 0
    req.doctor.currentServingDate = today
  }
  const totalToday = await Appointment.countDocuments({ doctorId: req.doctor._id, date: today, status: { $in: ['confirmed', 'completed', 'no_show'] } })
  if (req.doctor.currentServingToken >= totalToday) {
    return res.status(400).json({ message: 'No more patients waiting in today\'s queue' })
  }
  req.doctor.currentServingToken += 1
  await req.doctor.save()
  res.json({ currentServingToken: req.doctor.currentServingToken })
})

export default router
