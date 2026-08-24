import express from 'express'
import MedicalStore from '../models/MedicalStore.js'
import { protect, optionalAuth, requireRole, adminOnly } from '../middleware/auth.js'
import { attachStore, loadStoreParam } from '../middleware/storeAuth.js'
import { upload } from '../middleware/upload.js'
import { uploadBufferToCloudinary, isCloudinaryConfigured } from '../config/cloudinary.js'

const router = express.Router()

const REQUIRED_FIELDS = ['storeName', 'phone', 'email', 'state', 'district', 'city', 'pinCode']

// POST /api/stores — a logged-in 'owner' account registers their store.
// One store per owner account for now (spec doesn't ask for an owner running
// multiple stores). Store starts pending/pending — invisible to customers
// until Super Admin approves it AND a subscription becomes active (section 4).
router.post('/', protect, requireRole('owner'), async (req, res) => {
  try {
    const existing = await MedicalStore.findOne({ ownerId: req.user._id })
    if (existing) {
      return res.status(409).json({ message: 'This account already has a registered store.' })
    }
    const missing = REQUIRED_FIELDS.filter((f) => !req.body[f])
    if (missing.length) {
      return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` })
    }
    const store = await MedicalStore.create({
      ownerId: req.user._id,
      storeName: req.body.storeName,
      pharmacistName: req.body.pharmacistName || '',
      phone: req.body.phone,
      email: req.body.email,
      logo: req.body.logo || '',
      address: req.body.address || '',
      state: req.body.state,
      district: req.body.district,
      city: req.body.city,
      area: req.body.area || '',
      pinCode: req.body.pinCode,
      licenseDetails: req.body.licenseDetails || {},
      gstDetails: req.body.gstDetails || {},
      openingTime: req.body.openingTime || '09:00',
      closingTime: req.body.closingTime || '21:00',
    })
    res.status(201).json(store)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/stores/mine — the logged-in owner's own store (with private fields).
router.get('/mine', protect, requireRole('owner'), attachStore, async (req, res) => {
  res.json(req.store)
})

// PUT /api/stores/mine — owner edits their own store profile. Ownership fields
// (ownerId, verificationStatus, subscriptionStatus) are never accepted from
// the client — they're admin/system controlled only.
const OWNER_EDITABLE_FIELDS = [
  'storeName', 'pharmacistName', 'phone', 'email', 'logo', 'address',
  'state', 'district', 'city', 'area', 'pinCode', 'licenseDetails',
  'gstDetails', 'openingTime', 'closingTime', 'isOpen', 'deliveryMode',
]
router.put('/mine', protect, requireRole('owner'), attachStore, async (req, res) => {
  for (const field of OWNER_EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) req.store[field] = req.body[field]
  }
  await req.store.save()
  res.json(req.store)
})

// PUT /api/stores/mine/qr-code — owner uploads their own UPI QR code image
// (multipart/form-data, field name "file"). Admin uses this to manually pay
// out store settlements by scanning it — there's no automated bank-transfer
// integration, so this is the payout mechanism (see spec: subscription first,
// then QR upload, so admin can pay them later). Never shown to customers —
// only surfaced on admin settlement/payout screens.
router.put('/mine/qr-code', protect, requireRole('owner'), attachStore, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        message: 'File storage is not configured yet on the server. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the backend environment variables.',
      })
    }
    const result = await uploadBufferToCloudinary(req.file.buffer, { folder: 'mednex/store-qr-codes' })
    req.store.qrCodeUrl = result.secure_url
    req.store.qrCodeUploadedAt = new Date()
    await req.store.save()
    res.json(req.store)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/stores/search?pinCode=824101 — the customer-facing PIN search
// (spec section 3). Public, no auth required. Only returns stores that are
// currently marketplace-eligible — pending verification, expired
// subscriptions, and manually-closed stores never show up here, even though
// they still exist in the database (spec section 4: hide, don't delete).
router.get('/search', async (req, res) => {
  const { pinCode, city } = req.query
  if (!pinCode && !city) {
    return res.status(400).json({ message: 'pinCode or city is required' })
  }
  const filter = MedicalStore.marketplaceEligibleFilter(pinCode ? { pinCode } : { city: new RegExp(`^${city}$`, 'i') })
  // -qrCodeUrl/-licenseDetails/-gstDetails: this is a public, unauthenticated
  // endpoint — never return a store's payout QR code or compliance paperwork
  // to a customer just searching by PIN code.
  const stores = await MedicalStore.find(filter).select('-qrCodeUrl -qrCodeUploadedAt -licenseDetails -gstDetails').sort({ ratingAvg: -1, storeName: 1 })
  res.json(stores)
})

// GET /api/stores/:id — public store profile. Only exposes stores that are
// currently marketplace-eligible, UNLESS the requester is that store's own
// owner or a platform admin (who need to see pending/expired stores too).
router.get('/:id', optionalAuth, async (req, res) => {
  const store = await MedicalStore.findById(req.params.id)
  if (!store) return res.status(404).json({ message: 'Store not found' })

  const isOwner = req.user && req.user.role === 'owner' && String(store.ownerId) === String(req.user._id)
  const isAdmin = req.user && (req.user.role === 'admin' || req.user.isAdmin)
  if (!store.isMarketplaceEligible() && !isOwner && !isAdmin) {
    return res.status(404).json({ message: 'This store is not currently available' })
  }

  // qrCodeUrl is how admin pays this store out — never leak it to the
  // public store page. licenseDetails/gstDetails are similarly the store's
  // private compliance paperwork, not customer-facing info.
  if (!isOwner && !isAdmin) {
    const { qrCodeUrl, qrCodeUploadedAt, licenseDetails, gstDetails, ...publicFields } = store.toObject()
    return res.json(publicFields)
  }
  res.json(store)
})

// --- Super Admin: store oversight (spec section 14) ---

// GET /api/stores?status=pending — every store, optionally filtered.
router.get('/', protect, adminOnly, async (req, res) => {
  const filter = {}
  if (req.query.verificationStatus) filter.verificationStatus = req.query.verificationStatus
  if (req.query.subscriptionStatus) filter.subscriptionStatus = req.query.subscriptionStatus
  if (req.query.pinCode) filter.pinCode = req.query.pinCode
  const stores = await MedicalStore.find(filter).populate('ownerId', 'name email mobile').sort({ createdAt: -1 })
  res.json(stores)
})

// PUT /api/stores/:storeId/verify — approve or reject a store.
router.put('/:storeId/verify', protect, adminOnly, loadStoreParam, async (req, res) => {
  const { verificationStatus, verificationNote } = req.body
  if (!['pending', 'approved', 'rejected'].includes(verificationStatus)) {
    return res.status(400).json({ message: 'verificationStatus must be pending, approved, or rejected' })
  }
  req.store.verificationStatus = verificationStatus
  req.store.verificationNote = verificationNote || ''
  req.store.verifiedAt = verificationStatus === 'approved' ? new Date() : null
  req.store.verifiedBy = req.user._id
  await req.store.save()
  res.json(req.store)
})

// PUT /api/stores/:storeId/active — Super Admin kill switch, independent of
// verification/subscription (e.g. a fraud report while investigation is open).
router.put('/:storeId/active', protect, adminOnly, loadStoreParam, async (req, res) => {
  req.store.isOpen = !!req.body.isOpen
  await req.store.save()
  res.json(req.store)
})

export default router
