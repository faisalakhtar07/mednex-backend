import express from 'express'
import User from '../models/User.js'
import Order from '../models/Order.js'
import MedicalStore from '../models/MedicalStore.js'
import AdminSettings from '../models/AdminSettings.js'
import DeliveryAssignment from '../models/DeliveryAssignment.js'
import StoreSettlement from '../models/StoreSettlement.js'
import DeliveryPayout from '../models/DeliveryPayout.js'
import Subscription from '../models/Subscription.js'
import FeaturedItem from '../models/FeaturedItem.js'
import { protect, adminOnly } from '../middleware/auth.js'
import { logAdminAction } from '../utils/audit.js'

const router = express.Router()
router.use(protect, adminOnly)

// GET /api/admin/customers — every customer with their order count & total spend, platform-wide
router.get('/customers', async (req, res) => {
  const users = await User.find({ role: 'customer' }).select('-password')
  const orders = await Order.find({})

  const data = users.map((u) => {
    const userOrders = orders.filter((o) => String(o.user) === String(u._id))
    return {
      _id: u._id,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      joined: u.createdAt,
      orderCount: userOrders.length,
      totalSpent: userOrders.reduce((sum, o) => sum + (o.total || 0), 0),
    }
  })
  res.json(data.sort((a, b) => b.totalSpent - a.totalSpent))
})

// GET /api/admin/customers/:id — everything one specific customer bought, across all stores
router.get('/customers/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select('-password')
  if (!user) return res.status(404).json({ message: 'Customer not found' })
  const orders = await Order.find({ user: user._id }).populate('storeId', 'storeName').sort({ createdAt: -1 })
  res.json({ user, orders })
})

// GET /api/admin/stats — platform-wide summary numbers for the Super Admin dashboard
router.get('/stats', async (req, res) => {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const [
    totalOrders, totalCustomers, orders, totalStores, pendingStores, activeStores,
    settlements, todaySettlements, monthSettlements,
    subscribedStores, activeSubscriptions, allRiders,
    pendingSettlementDocs,
  ] = await Promise.all([
    Order.countDocuments(),
    User.countDocuments({ role: 'customer' }),
    Order.find({}, 'total createdAt'),
    MedicalStore.countDocuments(),
    MedicalStore.countDocuments({ verificationStatus: 'pending' }),
    MedicalStore.countDocuments(MedicalStore.marketplaceEligibleFilter()),
    StoreSettlement.find({}, 'platformCommission createdAt'),
    StoreSettlement.find({ createdAt: { $gte: startOfToday } }, 'platformCommission'),
    StoreSettlement.find({ createdAt: { $gte: startOfMonth } }, 'platformCommission'),
    MedicalStore.countDocuments({ subscriptionStatus: 'active' }),
    Subscription.find({ status: 'active' }, 'paymentInformation'),
    User.find({ role: 'delivery', 'deliveryProfile.scope': 'platform' }, 'deliveryProfile.pendingPayout deliveryProfile.paidAmount'),
    StoreSettlement.find({ status: 'pending' }, 'settlementAmount'),
  ])

  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0)
  const sumCommission = (arr) => arr.reduce((sum, s) => sum + s.platformCommission, 0)
  // "Sara amount" — every money figure an admin needs in one place, per the
  // explicit ask that all revenue/commission/pending numbers surface here
  // rather than being scattered across separate tabs.
  const totalSubscriptionRevenue = activeSubscriptions.reduce((sum, s) => sum + (s.paymentInformation?.amount || 0), 0)
  const pendingSettlementsAmount = pendingSettlementDocs.reduce((sum, s) => sum + s.settlementAmount, 0)
  const pendingRiderPayouts = allRiders.reduce((sum, r) => sum + (r.deliveryProfile?.pendingPayout || 0), 0)
  const totalPaidToRiders = allRiders.reduce((sum, r) => sum + (r.deliveryProfile?.paidAmount || 0), 0)

  res.json({
    totalOrders,
    totalCustomers,
    totalRevenue,
    totalStores,
    pendingStores,
    activeStores,
    subscribedStores,
    commission: { today: sumCommission(todaySettlements), monthly: sumCommission(monthSettlements), total: sumCommission(settlements) },
    money: {
      totalSubscriptionRevenue,
      pendingSettlementsAmount, // owed to stores, not yet paid
      pendingRiderPayouts, // owed to riders, not yet paid
      totalPaidToRiders, // lifetime, already paid out
    },
  })
})

// GET /api/admin/delivery-boys/today — for each MedNex-fleet rider, today's
// completed deliveries and whether they've been fully paid out yet. Only
// platform-scope riders — a store's own delivery staff are paid by their
// owner directly, not tracked in MedNex's payout system (spec section 11).
// Payouts are batched (DeliveryPayout.assignmentIds), so "paid" here means
// every one of today's Delivered assignments is already covered by some
// payout — otherwise it's "unpaid" even if an older batch happens to
// include some of today's earlier deliveries.
router.get('/delivery-boys/today', async (req, res) => {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const riders = await User.find({ role: 'delivery', 'deliveryProfile.scope': 'platform' }).select('-password')
  const result = []
  for (const rider of riders) {
    const todayAssignments = await DeliveryAssignment.find({ deliveryBoyId: rider._id, status: 'Delivered', deliveredAt: { $gte: startOfToday } })
    if (!todayAssignments.length) {
      result.push({ riderId: rider._id, name: rider.name, mobile: rider.mobile, deliveries: 0, earnedToday: 0, paidToday: 0, unpaidToday: 0, fullyPaid: true })
      continue
    }
    const paidAssignmentIds = new Set((await DeliveryPayout.find({ deliveryBoyId: rider._id }).distinct('assignmentIds')).map(String))
    let earnedToday = 0
    let paidToday = 0
    for (const a of todayAssignments) {
      earnedToday += a.deliveryBoyEarning
      if (paidAssignmentIds.has(String(a._id))) paidToday += a.deliveryBoyEarning
    }
    result.push({
      riderId: rider._id,
      name: rider.name,
      mobile: rider.mobile,
      deliveries: todayAssignments.length,
      earnedToday,
      paidToday,
      unpaidToday: earnedToday - paidToday,
      fullyPaid: paidToday === earnedToday,
    })
  }
  res.json(result.sort((a, b) => b.unpaidToday - a.unpaidToday))
})

// --- Platform settings (spec sections 9-11, 39: everything admin-configurable) ---

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

// --- Delivery rider management (spec section 7) ---
// Platform-scope riders only — a store's own delivery staff (deliveryProfile.
// scope === 'store') are that store owner's responsibility to manage, not
// Super Admin's; they're intentionally excluded from every route below.

router.get('/delivery-boys', async (req, res) => {
  const filter = { role: 'delivery', 'deliveryProfile.scope': 'platform' }
  if (req.query.verificationStatus) filter['deliveryProfile.verificationStatus'] = req.query.verificationStatus
  const riders = await User.find(filter).select('-password')
  res.json(riders)
})

router.put('/delivery-boys/:id/verify', async (req, res) => {
  const { verificationStatus } = req.body
  if (!['pending', 'approved', 'rejected'].includes(verificationStatus)) {
    return res.status(400).json({ message: 'verificationStatus must be pending, approved, or rejected' })
  }
  const rider = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'delivery', 'deliveryProfile.scope': 'platform' },
    { 'deliveryProfile.verificationStatus': verificationStatus },
    { new: true }
  ).select('-password')
  if (!rider) return res.status(404).json({ message: 'Delivery rider not found' })
  await logAdminAction(req.user._id, 'delivery-boy.verify', 'User', rider._id, { verificationStatus })
  res.json(rider)
})

router.put('/delivery-boys/:id/active', async (req, res) => {
  const rider = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'delivery', 'deliveryProfile.scope': 'platform' },
    { active: !!req.body.active },
    { new: true }
  ).select('-password')
  if (!rider) return res.status(404).json({ message: 'Delivery rider not found' })
  await logAdminAction(req.user._id, 'delivery-boy.active', 'User', rider._id, { active: rider.active })
  res.json(rider)
})

// --- Delivery assignment oversight (spec section 8) ---

// GET /api/admin/assignments?status=Unassigned — every assignment, platform-wide
router.get('/assignments', async (req, res) => {
  const filter = {}
  if (req.query.status) filter.status = req.query.status
  const assignments = await DeliveryAssignment.find(filter)
    .populate('orderId', 'orderNumber total')
    .populate('storeId', 'storeName city')
    .populate('deliveryBoyId', 'name mobile')
    .sort({ createdAt: -1 })
  res.json(assignments)
})

// PUT /api/admin/assignments/:id/assign — manually assign a MedNex-fleet
// rider to a broadcast that's sitting unclaimed, or reassign one that needs
// it. Only for 'mednex' mode — an 'own' mode assignment belongs to a
// specific store's own staff and is never admin's to reassign.
router.put('/assignments/:id/assign', async (req, res) => {
  const { deliveryBoyId } = req.body
  const rider = await User.findOne({ _id: deliveryBoyId, role: 'delivery', 'deliveryProfile.scope': 'platform', active: true, 'deliveryProfile.verificationStatus': 'approved' })
  if (!rider) return res.status(404).json({ message: 'Rider not found, not approved, or inactive' })

  const assignment = await DeliveryAssignment.findById(req.params.id)
  if (!assignment) return res.status(404).json({ message: 'Assignment not found' })
  if (assignment.mode !== 'mednex') {
    return res.status(400).json({ message: 'Only MedNex-delivery assignments can be reassigned by admin — this order uses the store\'s own delivery team' })
  }
  if (['Delivered', 'Cancelled'].includes(assignment.status)) {
    return res.status(400).json({ message: `Cannot reassign an assignment that is already ${assignment.status}` })
  }
  assignment.deliveryBoyId = rider._id
  assignment.status = 'Accepted' // admin assigning directly skips the separate accept step, same as a claim would
  assignment.assignedAt = assignment.assignedAt || new Date()
  assignment.acceptedAt = new Date()
  await assignment.save()
  await logAdminAction(req.user._id, 'assignment.assign', 'DeliveryAssignment', assignment._id, { deliveryBoyId })
  res.json(assignment)
})

// --- Store settlements (spec section 10/12) ---

router.get('/settlements', async (req, res) => {
  const filter = {}
  if (req.query.status) filter.status = req.query.status
  if (req.query.storeId) filter.storeId = req.query.storeId
  const settlements = await StoreSettlement.find(filter).populate('storeId', 'storeName qrCodeUrl').populate('orderId', 'orderNumber').sort({ createdAt: -1 })
  res.json(settlements)
})

router.put('/settlements/:id/process', async (req, res) => {
  const { status, paymentReference } = req.body
  if (!['processed', 'paid', 'failed'].includes(status)) {
    return res.status(400).json({ message: 'status must be processed, paid, or failed' })
  }
  const settlement = await StoreSettlement.findById(req.params.id)
  if (!settlement) return res.status(404).json({ message: 'Settlement not found' })
  settlement.status = status
  settlement.paymentReference = paymentReference || settlement.paymentReference
  settlement.processedBy = req.user._id
  if (status === 'paid') settlement.paidAt = new Date()
  await settlement.save()
  await logAdminAction(req.user._id, 'settlement.process', 'StoreSettlement', settlement._id, { status, paymentReference })
  res.json(settlement)
})

// --- Delivery rider payouts (spec section 12) ---

router.get('/payouts', async (req, res) => {
  const filter = {}
  if (req.query.deliveryBoyId) filter.deliveryBoyId = req.query.deliveryBoyId
  const payouts = await DeliveryPayout.find(filter).populate('deliveryBoyId', 'name mobile').sort({ createdAt: -1 })
  res.json(payouts)
})

// POST /api/admin/payouts — pay out every unpaid completed delivery for one
// rider. "Unpaid" here means every Delivered assignment not already covered
// by a previous payout — tracked via the assignmentIds list on past payouts
// rather than a boolean flag, so the payout trail stays fully itemized
// (spec section 12: "Create payout records with... Number of deliveries").
router.post('/payouts', async (req, res) => {
  const { deliveryBoyId } = req.body
  const rider = await User.findOne({ _id: deliveryBoyId, role: 'delivery', 'deliveryProfile.scope': 'platform' })
  if (!rider) return res.status(404).json({ message: 'Delivery rider not found' })

  const alreadyPaidIds = (await DeliveryPayout.find({ deliveryBoyId }).distinct('assignmentIds')).flat()
  const unpaidAssignments = await DeliveryAssignment.find({ deliveryBoyId, status: 'Delivered', _id: { $nin: alreadyPaidIds } })
  if (!unpaidAssignments.length) return res.status(400).json({ message: 'No unpaid completed deliveries for this rider' })

  const amount = unpaidAssignments.reduce((sum, a) => sum + a.deliveryBoyEarning, 0)
  const dates = unpaidAssignments.map((a) => a.deliveredAt)
  const payout = await DeliveryPayout.create({
    deliveryBoyId,
    assignmentIds: unpaidAssignments.map((a) => a._id),
    deliveryCount: unpaidAssignments.length,
    amount,
    periodStart: new Date(Math.min(...dates)),
    periodEnd: new Date(Math.max(...dates)),
    status: 'pending',
    processedBy: req.user._id,
  })
  await logAdminAction(req.user._id, 'payout.create', 'DeliveryPayout', payout._id, { deliveryBoyId, amount, deliveryCount: unpaidAssignments.length })
  res.status(201).json(payout)
})

// PUT /api/admin/payouts/:id/pay — mark a payout as actually paid (after
// sending the money via whatever bank/UPI method), moving its amount from
// the rider's pendingPayout to paidAmount.
router.put('/payouts/:id/pay', async (req, res) => {
  const payout = await DeliveryPayout.findById(req.params.id)
  if (!payout) return res.status(404).json({ message: 'Payout not found' })
  if (payout.status === 'paid') return res.status(400).json({ message: 'Already marked paid' })

  payout.status = 'paid'
  payout.paymentReference = req.body.paymentReference || ''
  payout.paidAt = new Date()
  await payout.save()

  await User.findByIdAndUpdate(payout.deliveryBoyId, {
    $inc: { 'deliveryProfile.pendingPayout': -payout.amount, 'deliveryProfile.paidAmount': payout.amount },
  })
  await logAdminAction(req.user._id, 'payout.pay', 'DeliveryPayout', payout._id, { amount: payout.amount })
  res.json(payout)
})

// --- Homepage "MedNex Picks" showcase cards (spec: admin-managed, name + price + image) ---

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
