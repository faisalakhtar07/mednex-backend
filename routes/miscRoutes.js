import express from 'express'
import { LabTest, LabBooking, Prescription } from '../models/OtherModels.js'
import FeaturedItem from '../models/FeaturedItem.js'
import { protect, adminOnly } from '../middleware/auth.js'
import { upload } from '../middleware/upload.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured } from '../config/cloudinary.js'

const router = express.Router()

/* ---------- Homepage "MedNex Picks" (public, read-only) ---------- */
// Admin management lives under /api/admin/featured — this is the
// customer-facing read that Home.jsx calls, active items only.
router.get('/featured', async (req, res) => {
  const items = await FeaturedItem.find({ active: true }).sort({ order: 1, createdAt: -1 })
  res.json(items)
})

// NOTE: the old `/doctors` and `/consultations` routes (static Doctor list,
// single-shot Consultation booking, no staff/token/queue/subscription) have
// been removed as part of the Doctor Appointment & Token Queue System
// rebuild. Their replacement lives in dedicated `doctorRoutes.js`
// (customer-facing search/booking) and reuses `staffAuthRoutes.js` for
// doctor/doctor_staff auth — mounted separately in server.js, not here.

/* ---------- Lab Tests ---------- */
router.get('/labtests', async (req, res) => {
  const { category } = req.query
  const filter = category ? { category } : {}
  res.json(await LabTest.find(filter))
})

router.get('/labtests/:id', async (req, res) => {
  const test = await LabTest.findById(req.params.id)
  if (!test) return res.status(404).json({ message: 'Test not found' })
  res.json(test)
})

// POST /api/labbookings — book a lab test (requires login)
router.post('/labbookings', protect, async (req, res) => {
  const { testId, testName, price } = req.body
  const booking = await LabBooking.create({ user: req.user._id, test: testId, testName, price })
  res.status(201).json(booking)
})

router.get('/labbookings/mine', protect, async (req, res) => {
  res.json(await LabBooking.find({ user: req.user._id }).sort({ createdAt: -1 }))
})

router.get('/labbookings', protect, adminOnly, async (req, res) => {
  res.json(await LabBooking.find({}).populate('user', 'name email mobile').sort({ createdAt: -1 }))
})

/* ---------- Prescription Upload ---------- */
// POST /api/prescriptions — multipart/form-data with field name "file"
// NOTE: prescriptions are no longer tied to a storeId (the medical-store
// marketplace has been removed) — this is now just the patient's own
// upload/history, reviewable by admin only.
router.post('/prescriptions', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        message: 'File storage is not configured yet on the server. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the backend environment variables (free account at cloudinary.com).',
      })
    }
    const result = await uploadBufferToCloudinary(req.file.buffer, { folder: 'mednex/prescriptions' })
    const prescription = await Prescription.create({
      user: req.user._id,
      fileUrl: result.secure_url, // permanent Cloudinary URL — survives backend restarts/redeploys
      fileName: req.file.originalname,
    })
    res.status(201).json(prescription)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.get('/prescriptions/mine', protect, async (req, res) => {
  res.json(await Prescription.find({ user: req.user._id }).sort({ createdAt: -1 }))
})

// Platform-wide prescription list — Super Admin only.
router.get('/prescriptions', protect, adminOnly, async (req, res) => {
  res.json(await Prescription.find({}).populate('user', 'name email mobile').sort({ createdAt: -1 }))
})

router.put('/prescriptions/:id/status', protect, adminOnly, async (req, res) => {
  const p = await Prescription.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true })
  res.json(p)
})

export default router
