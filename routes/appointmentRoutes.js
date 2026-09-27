import express from 'express'
import Appointment from '../models/Appointment.js'
import DoctorProfile from '../models/DoctorProfile.js'
import Notification from '../models/Notification.js'
import User from '../models/User.js'
import { protect, requireRole } from '../middleware/auth.js'
import { sendPushToUser } from '../utils/sendPush.js'

const router = express.Router()

function midnight(dateInput) {
  const d = new Date(dateInput)
  d.setHours(0, 0, 0, 0)
  return d
}

// POST /api/appointments — patient books a slot-less, token-queue
// appointment for a given calendar day. Starts as 'requested' — it only
// gets a token once the doctor/staff confirms it (see
// doctorDashboardRoutes.js), so a patient can never jump the queue by
// booking directly into 'confirmed'.
router.post('/', protect, requireRole('customer'), async (req, res) => {
  try {
    const { doctorId, date, patientNote } = req.body
    if (!doctorId || !date) return res.status(400).json({ message: 'doctorId and date are required' })

    const doctor = await DoctorProfile.findById(doctorId)
    if (!doctor || !doctor.isMarketplaceEligible()) {
      return res.status(404).json({ message: 'Doctor not found or not currently accepting appointments' })
    }
    const day = midnight(date)
    if (day < midnight(new Date())) {
      return res.status(400).json({ message: 'Cannot book an appointment in the past' })
    }

    const appointment = await Appointment.create({
      doctorId: doctor._id,
      patientId: req.user._id,
      patientName: req.user.name || 'Patient',
      patientPhone: req.user.mobile,
      patientNote: patientNote || '',
      date: day,
      fee: doctor.consultationFee,
      status: 'requested',
    })

    // Notify the doctor + all their staff — anyone confirming duty sees it.
    const staffAndDoctor = await User.find({ $or: [{ _id: doctor.userId }, { role: 'doctor_staff', doctorId: doctor._id, active: true }] })
    for (const u of staffAndDoctor) {
      await Notification.create({
        user: u._id,
        title: 'New Appointment Request',
        message: `${appointment.patientName} requested an appointment for ${day.toLocaleDateString('en-IN')}.`,
        type: 'appointment_requested',
        relatedAppointment: appointment._id,
      })
      sendPushToUser(u._id, {
        title: 'New Appointment Request',
        body: `${appointment.patientName} requested an appointment for ${day.toLocaleDateString('en-IN')}.`,
        url: '/doctor',
      }).catch(() => {}) // push is best-effort — never block the booking on it
    }

    res.status(201).json(appointment)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/appointments/mine — the logged-in patient's own bookings
router.get('/mine', protect, requireRole('customer'), async (req, res) => {
  const appointments = await Appointment.find({ patientId: req.user._id })
    .populate('doctorId', 'name specialization clinicName city photo currentServingToken currentServingDate')
    .sort({ date: -1, createdAt: -1 })
  res.json(appointments)
})

// PUT /api/appointments/:id/cancel — patient cancels their own booking,
// only while it's still requested/confirmed (not already completed/past).
router.put('/:id/cancel', protect, requireRole('customer'), async (req, res) => {
  const appointment = await Appointment.findOne({ _id: req.params.id, patientId: req.user._id })
  if (!appointment) return res.status(404).json({ message: 'Appointment not found' })
  if (!['requested', 'confirmed'].includes(appointment.status)) {
    return res.status(400).json({ message: `Cannot cancel an appointment that is already ${appointment.status}` })
  }
  appointment.status = 'cancelled'
  await appointment.save()
  res.json(appointment)
})

export default router
