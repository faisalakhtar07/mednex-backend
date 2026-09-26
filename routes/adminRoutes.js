import express from 'express'
import User from '../models/User.js'
import DoctorProfile from '../models/DoctorProfile.js'
import AdminSettings from '../models/AdminSettings.js'
import Subscription from '../models/Subscription.js'
import FeaturedItem from '../models/FeaturedItem.js'
import { upload } from '../middleware/upload.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured } from '../config/cloudinary.js'
import { protect, adminOnly } from '../middleware/auth.js'
import { logAdminAction } from '../utils/audit.js'

const router = express.Router()
router.use(protect, adminOnly)

// NOTE: the old medical-store marketplace admin endpoints (store
// verification, delivery rider management, store settlements, rider
// payouts, order-based customer spend) have all been removed along with
// MedicalStore/Order/DeliveryAssignment/DeliveryPayout/StoreSettlement.
// "Stores" verification is replaced below by Doctor verification, using
// the same pending/approved/rejected shape.

// GET /api/admin/customers — every registered customer, platform-wide
router.get('/customers', async (req, res) => {
  const users = await User.find({ role: 'customer' }).select('-password').sort({ createdAt: -1 })
  res.json(users)
})

router.get('/customers/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select('-password')
  if (!user) return res.status(404).json({ message: 'Customer not found' })
  res.json({ user })
})

// GET /api/admin/stats — platform-wide summary numbers for the Super Admin dashboard
router.get('/stats', async (req, res) => {
  const [totalCustomers, totalDoctors, pendingDoctors, activeDoctors, subscribedDoctors, activeSubscriptions] = await Promise.all([
    User.countDocuments({ role: 'customer' }),
    DoctorProfile.countDocuments(),
    DoctorProfile.countDocuments({ verificationStatus: 'pending' }),
    DoctorProfile.countDocuments(DoctorProfile.marketplaceEligibleFilter()),
    DoctorProfile.countDocuments({ subscriptionStatus: 'active' }),
    Subscription.find({ status: 'active' }, 'paymentInformation'),
  ])

  const totalSubscriptionRevenue = activeSubscriptions.reduce((sum, s) => sum + (s.paymentInformation?.amount || 0), 0)

  res.json({
    totalCustomers,
    totalDoctors,
    pendingDoctors,
    activeDoctors,
    subscribedDoctors,
    money: {
      totalSubscriptionRevenue,
    },
  })
})

// --- Doctor verification (replaces the old Store verification) ---

router.get('/doctors', async (req, res) => {
  const filter = {}
  if (req.query.verificationStatus) filter.verificationStatus = req.query.verificationStatus
  const doctors = await DoctorProfile.find(filter).populate('userId', 'name email mobile').sort({ createdAt: -1 })
  res.json(doctors)
})

router.put('/doctors/:id/verify', async (req, res) => {
  const { verificationStatus, verificationNote } = req.body
  if (!['approved', 'rejected'].includes(verificationStatus)) {
    return res.status(400).json({ message: 'verificationStatus must be approved or rejected' })
  }
  const doctor = await DoctorProfile.findById(req.params.id)
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' })
  doctor.verificationStatus = verificationStatus
  doctor.verificationNote = verificationNote || ''
  doctor.verifiedAt = new Date()
  doctor.verifiedBy = req.user._id
  await doctor.save()
  await logAdminAction(req.user._id, 'doctor.verify', 'DoctorProfile', doctor._id, { verificationStatus, verificationNote })
  res.json(doctor)
})

router.put('/doctors/:id/active', async (req, res) => {
  const doctor = await DoctorProfile.findByIdAndUpdate(req.params.id, { isAvailable: req.body.isAvailable }, { new: true })
  if (!doctor) return res.status(404).json({ message: 'Doctor not found' })
  res.json(doctor)
})

// --- Platform settings ---

router.get('/settings', async (req, res) => {
  res.json(await AdminSettings.getSettings())
})

router.put('/settings', async (req, res) => {
  const settings = await AdminSettings.getSettings()
  const before = settings.toObject()
  Object.assign(settings, req.body)
  await settings.save()
  await logAdminAction(req.user._id, 'settings.update', 'AdminSettings', settings._id, { before, after: req.body })
  res.json(settings)
})

// --- Homepage "MedNex Picks" showcase cards (admin-managed, name + price + image) ---

// GET /api/admin/featured — every card, including inactive ones, for the admin list view.
router.get('/featured', async (req, res) => {
  const items = await FeaturedItem.find({}).sort({ order: 1, createdAt: -1 })
  res.json(items)
})

router.post('/featured', async (req, res) => {
  try {
    const item = await FeaturedItem.create(req.body)
    await logAdminAction(req.user._id, 'featured.create', 'FeaturedItem', item._id, { name: item.name })
    res.status(201).json(item)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/admin/featured/upload-image — uploads a real photo file (not a
// pasted URL) for a MedNex Picks card. Returns just the URL; the admin still
// calls POST/PUT /featured separately with that URL in the `image` field —
// this keeps the upload step reusable for both "new card" and "edit card".
router.post('/featured/upload-image', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        message: 'File storage is not configured yet on the server. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the backend environment variables.',
      })
    }
    const result = await uploadBufferToCloudinary(req.file.buffer, { folder: 'mednex/featured' })
    res.json({ url: result.secure_url })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.put('/featured/:id', async (req, res) => {
  const item = await FeaturedItem.findByIdAndUpdate(req.params.id, req.body, { new: true })
  if (!item) return res.status(404).json({ message: 'Featured item not found' })
  await logAdminAction(req.user._id, 'featured.update', 'FeaturedItem', item._id, req.body)
  res.json(item)
})

router.delete('/featured/:id', async (req, res) => {
  const item = await FeaturedItem.findByIdAndDelete(req.params.id)
  if (!item) return res.status(404).json({ message: 'Featured item not found' })
  await logAdminAction(req.user._id, 'featured.delete', 'FeaturedItem', item._id, { name: item.name })
  res.json({ message: 'Deleted' })
})

export default router
