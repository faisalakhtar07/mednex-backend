import express from 'express'
import Order from '../models/Order.js'
import User from '../models/User.js'
import DeliveryAssignment from '../models/DeliveryAssignment.js'
import StoreSettlement from '../models/StoreSettlement.js'
import AdminSettings from '../models/AdminSettings.js'
import { protect, requireRole } from '../middleware/auth.js'
import { notifyOrderStatus } from '../utils/notify.js'
import { calculateSettlement } from '../utils/commission.js'

const router = express.Router()
router.use(protect, requireRole('delivery'))

// GET /api/delivery/profile — this rider's own platform-wide profile (spec section 7)
router.get('/profile', async (req, res) => {
  res.json(req.user)
})

// PUT /api/delivery/profile — riders can edit their own photo/bank details.
// verificationStatus is deliberately NOT editable here — only admin can set it.
router.put('/profile', async (req, res) => {
  const { profilePhoto, bankDetails } = req.body
  const user = await User.findById(req.user._id)
  if (profilePhoto !== undefined) user.deliveryProfile.profilePhoto = profilePhoto
  if (bankDetails) user.deliveryProfile.bankDetails = { ...user.deliveryProfile.bankDetails, ...bankDetails }
  await user.save()
  res.json(user)
})

// PUT /api/delivery/availability — toggle online/offline. Only 'online' +
// 'approved' riders are eligible for auto-assignment (see ownerRoutes.js confirm route).
router.put('/availability', async (req, res) => {
  const { availability } = req.body
  if (!['online', 'offline'].includes(availability)) {
    return res.status(400).json({ message: 'availability must be online or offline' })
  }
  if (availability === 'online' && req.user.deliveryProfile.verificationStatus !== 'approved') {
    return res.status(403).json({ message: 'Your account is not yet approved by MedNex — you cannot go online until Super Admin verifies your documents.' })
  }
  const user = await User.findByIdAndUpdate(req.user._id, { 'deliveryProfile.availability': availability }, { new: true })
  res.json(user)
})

// GET /api/delivery/assignments/broadcasting — every 'mednex' mode order
// that's been broadcast to the whole online rider pool and not yet claimed
// by anyone. Only meaningful for platform-scope riders — store-scoped
// riders (an owner's own staff) never see this, they only get orders
// assigned to them directly. Deliberately doesn't populate customer
// name/phone — that stays hidden until a rider actually claims it.
router.get('/assignments/broadcasting', async (req, res) => {
  if (req.user.deliveryProfile.scope !== 'platform') {
    return res.json([]) // store-scoped riders never see the broadcast pool
  }
  const assignments = await DeliveryAssignment.find({ mode: 'mednex', status: 'Broadcasting' })
    .populate('orderId', 'orderNumber total address')
    .populate('storeId', 'storeName city pinCode')
    .sort({ broadcastAt: 1 }) // oldest first — fairest for riders scanning the list
  res.json(assignments)
})

// PUT /api/delivery/assignments/:id/claim — first request wins, atomically.
// See DeliveryAssignment.claimBroadcast for the concurrency-safety
// guarantee. A 409 here means another rider claimed it a moment earlier —
// the frontend should treat that as "already taken", not retry.
router.put('/assignments/:id/claim', async (req, res) => {
  if (req.user.deliveryProfile.scope !== 'platform') {
    return res.status(403).json({ message: 'Only MedNex-fleet riders can claim broadcast deliveries' })
  }
  if (req.user.deliveryProfile.availability !== 'online') {
    return res.status(403).json({ message: 'Go online first to claim a delivery' })
  }
  const assignment = await DeliveryAssignment.claimBroadcast(req.params.id, req.user._id)
  if (!assignment) {
    return res.status(409).json({ message: 'This delivery was just claimed by another rider', taken: true })
  }
  await Order.findByIdAndUpdate(assignment.orderId, { status: 'Out for Delivery' })
  res.json(assignment)
})

// GET /api/delivery/assignments?status=Assigned — only assignments given to THIS rider.
router.get('/assignments', async (req, res) => {
  const filter = { deliveryBoyId: req.user._id }
  if (req.query.status) filter.status = req.query.status
  const assignments = await DeliveryAssignment.find(filter)
    .populate({ path: 'orderId', select: 'orderNumber items address total deliveryOtp user', populate: { path: 'user', select: 'name mobile' } })
    .populate('storeId', 'storeName address city pinCode phone')
    .sort({ createdAt: -1 })
  res.json(assignments)
})

// GET /api/delivery/assignments/:id
router.get('/assignments/:id', async (req, res) => {
  const assignment = await DeliveryAssignment.findOne({ _id: req.params.id, deliveryBoyId: req.user._id })
    .populate({ path: 'orderId', select: 'orderNumber items address total deliveryOtp user', populate: { path: 'user', select: 'name mobile' } })
    .populate('storeId', 'storeName address city pinCode phone')
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
  res.json(assignment)
})

// PUT /api/delivery/assignments/:id/accept — 'Assigned' -> 'Accepted'
router.put('/assignments/:id/accept', async (req, res) => {
  const assignment = await DeliveryAssignment.findOne({ _id: req.params.id, deliveryBoyId: req.user._id })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
  if (assignment.status !== 'Assigned') {
    return res.status(400).json({ message: `Cannot accept an assignment in status ${assignment.status}` })
  }
  assignment.status = 'Accepted'
  assignment.acceptedAt = new Date()
  await assignment.save()
  await Order.findByIdAndUpdate(assignment.orderId, { status: 'Out for Delivery' })
  res.json(assignment)
})

// PUT /api/delivery/assignments/:id/status — forward-only enroute transitions.
// 'Picked Up' is reachable only via /verify-pickup below (requires the store's
// code); 'Delivered' is reachable only via /deliver below (requires the
// customer's code) — both are deliberately excluded from this generic setter
// so neither handoff can be faked by just PATCHing a status string.
const FORWARD_TRANSITIONS = {
  Accepted: 'Going to Store',
  'Going to Store': 'Reached Store',
  'Picked Up': 'Going to Customer',
  'Going to Customer': 'Reached Customer',
}
router.put('/assignments/:id/status', async (req, res) => {
  const assignment = await DeliveryAssignment.findOne({ _id: req.params.id, deliveryBoyId: req.user._id })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
  const expectedNext = FORWARD_TRANSITIONS[assignment.status]
  if (!expectedNext || req.body.status !== expectedNext) {
    return res.status(400).json({ message: `From ${assignment.status}, the only valid next status is ${expectedNext || 'none — use /verify-pickup or /deliver'}` })
  }
  assignment.status = expectedNext
  await assignment.save()
  res.json(assignment)
})

// PUT /api/delivery/assignments/:id/verify-pickup — store hands the rider a
// pickup code out loud/on-screen; rider enters it here. Only on a correct
// match does the assignment move to 'Picked Up' (spec section 6).
router.put('/assignments/:id/verify-pickup', async (req, res) => {
  const assignment = await DeliveryAssignment.findOne({ _id: req.params.id, deliveryBoyId: req.user._id })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
  if (assignment.status !== 'Reached Store') {
    return res.status(400).json({ message: 'Mark "Reached Store" before verifying the pickup code' })
  }
  const ok = await assignment.verifyPickupCode(req.body.code)
  if (!ok) {
    assignment.pickupAttempts += 1
    await assignment.save()
    return res.status(400).json({ message: 'Incorrect pickup code — ask the store owner to re-confirm it' })
  }
  assignment.status = 'Picked Up'
  assignment.pickupVerifiedAt = new Date()
  await assignment.save()
  res.json(assignment)
})

// PUT /api/delivery/assignments/:id/deliver — final handoff to the customer,
// gated by the customer-facing Order.deliveryOtp (unchanged mechanism from
// before, just relocated here since delivery is no longer store-scoped).
// This is also where settlement gets computed — see ownerRoutes.js's confirm
// route for where the fee/earning were originally snapshotted; this just
// finalizes them.
router.put('/assignments/:id/deliver', async (req, res) => {
  const assignment = await DeliveryAssignment.findOne({ _id: req.params.id, deliveryBoyId: req.user._id })
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
  if (assignment.status !== 'Reached Customer') {
    return res.status(400).json({ message: 'Mark "Reached Customer" before completing delivery' })
  }
  const order = await Order.findById(assignment.orderId)
  if (!order.deliveryOtp) return res.status(400).json({ message: 'No delivery OTP was generated for this order' })
  if (!req.body.otp || String(req.body.otp).trim() !== order.deliveryOtp) {
    return res.status(400).json({ message: 'Incorrect OTP — ask the customer to check their app for the correct code' })
  }

  assignment.status = 'Delivered'
  assignment.deliveredAt = new Date()
  await assignment.save()

  order.status = 'Delivered'
  order.deliveryVerifiedAt = new Date()

  // Settlement is computed and locked in the moment delivery completes (spec
  // sections 10 & 39) — using the AdminSettings commission % active right
  // now, snapshotted onto the StoreSettlement so a later rate change never
  // rewrites an already-completed order's numbers.
  const settings = await AdminSettings.getSettings()
  const { platformCommissionPercent, platformCommission, deliveryBoyEarning, settlementAmount } = calculateSettlement(
    order.itemTotal || 0,
    assignment.deliveryFee,
    assignment.deliveryBoyEarning,
    assignment.mode,
    settings
  )
  const settlement = await StoreSettlement.create({
    orderId: order._id,
    storeId: order.storeId,
    itemTotal: order.itemTotal || 0,
    platformCommissionPercent,
    platformCommission,
    deliveryBoyEarning,
    settlementAmount,
  })
  order.settlementId = settlement._id
  await order.save()

  // Credit this rider's running totals — only for MedNex-fleet riders.
  // Store-scoped ('own' mode) riders are paid by their store directly,
  // outside MedNex's payout system entirely (spec section 11), so their
  // deliveryProfile totals stay untouched — deliveryBoyEarning is always 0
  // for 'own' mode anyway (see ownerRoutes.js), but skip the write
  // entirely rather than relying on "+= 0" to make that intent explicit.
  if (assignment.mode === 'mednex') {
    await User.findByIdAndUpdate(req.user._id, {
      $inc: {
        'deliveryProfile.totalDeliveries': 1,
        'deliveryProfile.totalEarnings': assignment.deliveryBoyEarning,
        'deliveryProfile.pendingPayout': assignment.deliveryBoyEarning,
      },
    })
  }

  await notifyOrderStatus(order.user, order)
  res.json({ assignment, order })
})

// GET /api/delivery/earnings — today's deliveries + running totals (spec section 7 example)
router.get('/earnings', async (req, res) => {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const todayAssignments = await DeliveryAssignment.find({
    deliveryBoyId: req.user._id,
    status: 'Delivered',
    deliveredAt: { $gte: startOfToday },
  })
    .populate('orderId', 'orderNumber')
    .sort({ deliveredAt: -1 })

  const todayEarnings = todayAssignments.reduce((sum, a) => sum + a.deliveryBoyEarning, 0)

  res.json({
    today: todayAssignments.map((a) => ({ orderNumber: a.orderId?.orderNumber, earning: a.deliveryBoyEarning, deliveredAt: a.deliveredAt })),
    todayEarnings,
    totalDeliveries: req.user.deliveryProfile.totalDeliveries,
    totalEarnings: req.user.deliveryProfile.totalEarnings,
    pendingPayout: req.user.deliveryProfile.pendingPayout,
    paidAmount: req.user.deliveryProfile.paidAmount,
  })
})

export default router
