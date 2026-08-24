import express from 'express'
import Order from '../models/Order.js'
import DeliveryAssignment from '../models/DeliveryAssignment.js'
import AdminSettings from '../models/AdminSettings.js'
import User from '../models/User.js'
import Product from '../models/Product.js'
import { Prescription } from '../models/OtherModels.js'
import { protect, requireRole } from '../middleware/auth.js'
import { attachStore, requireOwnedDoc } from '../middleware/storeAuth.js'
import { notifyOrderStatus, notifyDeliveryAssignment, notifyBroadcastToRiders } from '../utils/notify.js'
import { calculateDeliveryBoyEarning } from '../utils/commission.js'

const router = express.Router()
// attachStore loads req.store (this owner's own store) on every request below
// and 404s if they don't have one yet — every query in this file filters by
// req.store._id so one owner can never see another store's data.
router.use(protect, requireRole('owner'), attachStore)

// GET /api/owner/orders?status=Pending — this store's orders, optionally filtered
router.get('/orders', async (req, res) => {
  const filter = { storeId: req.store._id }
  if (req.query.status) filter.status = req.query.status
  const orders = await Order.find(filter).populate('user', 'name email mobile').sort({ createdAt: -1 })
  res.json(orders)
})

// GET /api/owner/orders/:id
router.get('/orders/:id', async (req, res) => {
  const order = await requireOwnedDoc(Order, req.params.id, req.store._id, res, 'Order not found')
  if (!order) return
  await order.populate('user', 'name email mobile')
  res.json(order)
})

// PUT /api/owner/orders/:id/confirm — the ONLY fulfilment action an owner has
// besides reject (spec section 5: "The owner should NOT have a 'Deliver
// Order' workflow"). This is where the delivery assignment, pickup code,
// and fee/earning snapshot are all created together, so they can never
// exist independently of a confirmed order.
//
// Body: { deliveryMode: 'own' | 'mednex', deliveryBoyId? }
//  - 'own': owner picks one of THEIR store's own riders directly
//    (deliveryBoyId required) — no broadcast, assigned immediately.
//  - 'mednex': broadcasts to every online+approved MedNex-fleet rider at
//    once; whoever claims it first (PUT /api/delivery/assignments/:id/claim)
//    gets it (spec section 8: "sabse pehle confirm kare use mile").
router.put('/orders/:id/confirm', async (req, res) => {
  const order = await requireOwnedDoc(Order, req.params.id, req.store._id, res, 'Order not found')
  if (!order) return
  if (order.status !== 'Pending') {
    return res.status(400).json({ message: `Cannot confirm an order in status ${order.status}` })
  }

  const deliveryMode = req.body.deliveryMode === 'own' ? 'own' : 'mednex'
  const settings = await AdminSettings.getSettings()
  const deliveryFee = order.deliveryFee || 0
  const { plain: pickupCodePlain, hash: pickupCodeHash } = await DeliveryAssignment.generatePickupCode()

  let assignment
  let notifiedRiderIds = []

  if (deliveryMode === 'own') {
    const rider = await User.findOne({
      _id: req.body.deliveryBoyId,
      role: 'delivery',
      storeId: req.store._id,
      'deliveryProfile.scope': 'store',
      active: true,
    })
    if (!rider) {
      return res.status(400).json({ message: 'Select an active delivery staff member for your store, or choose MedNex Delivery instead.' })
    }
    assignment = await DeliveryAssignment.create({
      orderId: order._id,
      storeId: req.store._id,
      mode: 'own',
      deliveryBoyId: rider._id,
      status: 'Assigned',
      assignedAt: new Date(),
      pickupCodeHash,
      deliveryFee,
      deliveryBoyEarning: 0, // MedNex never pays a store's own rider — see commission.js
    })
    notifiedRiderIds = [rider._id]
  } else {
    const deliveryBoyEarning = calculateDeliveryBoyEarning(deliveryFee, null, settings)
    assignment = await DeliveryAssignment.create({
      orderId: order._id,
      storeId: req.store._id,
      mode: 'mednex',
      deliveryBoyId: null,
      status: 'Broadcasting',
      broadcastAt: new Date(),
      pickupCodeHash,
      deliveryFee,
      deliveryBoyEarning,
    })
    const onlineRiders = await User.find({
      role: 'delivery',
      active: true,
      'deliveryProfile.scope': 'platform',
      'deliveryProfile.availability': 'online',
      'deliveryProfile.verificationStatus': 'approved',
    }).select('_id')
    notifiedRiderIds = onlineRiders.map((r) => r._id)
  }

  order.status = 'Confirmed'
  order.confirmedAt = new Date()
  order.deliveryMode = deliveryMode
  if (!order.deliveryOtp) order.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000))
  await order.save()

  await notifyOrderStatus(order.user, order)
  if (deliveryMode === 'own') {
    await notifyDeliveryAssignment(notifiedRiderIds[0], order, req.store.storeName)
  } else {
    await notifyBroadcastToRiders(notifiedRiderIds, order, req.store.storeName)
  }

  // The pickup code is returned in THIS response only, for the owner to read
  // out to the rider — it is never stored or exposed anywhere else in
  // plaintext (spec section 6).
  res.json({ order, assignment, pickupCode: pickupCodePlain, deliveryMode, ridersNotified: notifiedRiderIds.length })
})

// PUT /api/owner/orders/:id/reject — medicine/product unavailable.
router.put('/orders/:id/reject', async (req, res) => {
  const { reason } = req.body
  if (!reason) return res.status(400).json({ message: 'A rejection reason is required' })
  const order = await requireOwnedDoc(Order, req.params.id, req.store._id, res, 'Order not found')
  if (!order) return
  if (order.status !== 'Pending') {
    return res.status(400).json({ message: `Cannot reject an order in status ${order.status}` })
  }
  order.status = 'Rejected'
  order.rejectedAt = new Date()
  order.rejectionReason = reason
  await order.save()
  await notifyOrderStatus(order.user, order)
  res.json(order)
})

// GET /api/owner/stats — this store's dashboard summary only
router.get('/stats', async (req, res) => {
  const storeId = req.store._id
  const [total, pending, confirmed, rejected, outForDelivery, delivered, cancelled, paidOrders, customerIds, products] = await Promise.all([
    Order.countDocuments({ storeId }),
    Order.countDocuments({ storeId, status: 'Pending' }),
    Order.countDocuments({ storeId, status: 'Confirmed' }),
    Order.countDocuments({ storeId, status: 'Rejected' }),
    Order.countDocuments({ storeId, status: 'Out for Delivery' }),
    Order.countDocuments({ storeId, status: 'Delivered' }),
    Order.countDocuments({ storeId, status: 'Cancelled' }),
    Order.find({ storeId, paymentStatus: 'Paid' }, 'total'),
    Order.distinct('user', { storeId }),
    Product.find({ storeId }, 'stock status'),
  ])
  const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total || 0), 0)
  const outOfStock = products.filter((p) => p.stock <= 0).length
  res.json({ total, pending, confirmed, rejected, outForDelivery, delivered, cancelled, totalRevenue, customers: customerIds.length, productCount: products.length, outOfStock })
})

// GET /api/owner/customers — customers who have ordered from THIS store, with
// their order count/spend scoped to this store only (not their activity
// elsewhere on the platform).
router.get('/customers', async (req, res) => {
  const orders = await Order.find({ storeId: req.store._id }).populate('user', 'name email mobile createdAt')
  const byCustomer = new Map()
  for (const o of orders) {
    if (!o.user) continue
    const id = String(o.user._id)
    if (!byCustomer.has(id)) {
      byCustomer.set(id, { _id: o.user._id, name: o.user.name, email: o.user.email, mobile: o.user.mobile, joined: o.user.createdAt, orderCount: 0, totalSpent: 0 })
    }
    const entry = byCustomer.get(id)
    entry.orderCount += 1
    entry.totalSpent += o.total || 0
  }
  res.json([...byCustomer.values()].sort((a, b) => b.totalSpent - a.totalSpent))
})

// --- Prescriptions for this store only (spec section 12) ---

// GET /api/owner/prescriptions
router.get('/prescriptions', async (req, res) => {
  const prescriptions = await Prescription.find({ storeId: req.store._id }).populate('user', 'name email mobile').sort({ createdAt: -1 })
  res.json(prescriptions)
})

// PUT /api/owner/prescriptions/:id/status
router.put('/prescriptions/:id/status', async (req, res) => {
  const prescription = await requireOwnedDoc(Prescription, req.params.id, req.store._id, res, 'Prescription not found')
  if (!prescription) return
  prescription.status = req.body.status
  await prescription.save()
  res.json(prescription)
})

// --- Owner's own delivery staff (spec section 8: "Owner Delivery") ---
// Store-scoped riders — auto-approved (owner vouches for them, not Super
// Admin), never enter the platform-wide broadcast pool, only ever get
// orders this owner assigns them to directly via /orders/:id/confirm.

// POST /api/owner/delivery-staff
router.post('/delivery-staff', async (req, res) => {
  try {
    const { name, email, mobile, password } = req.body
    if (!name || !mobile || !password) {
      return res.status(400).json({ message: 'name, mobile, and password are required' })
    }
    const exists = await User.findOne({ $or: [{ email: email?.toLowerCase() }, { mobile }] })
    if (exists) return res.status(409).json({ message: 'An account with this email or mobile already exists' })
    const staff = await User.create({
      name,
      email,
      mobile,
      password,
      role: 'delivery',
      storeId: req.store._id,
      deliveryProfile: { scope: 'store', verificationStatus: 'approved' },
    })
    res.status(201).json({ _id: staff._id, name: staff.name, email: staff.email, mobile: staff.mobile, active: staff.active })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/owner/delivery-staff — this store's own riders only
router.get('/delivery-staff', async (req, res) => {
  const staff = await User.find({ role: 'delivery', storeId: req.store._id, 'deliveryProfile.scope': 'store' }).select('-password')
  res.json(staff)
})

// PUT /api/owner/delivery-staff/:id/active
router.put('/delivery-staff/:id/active', async (req, res) => {
  const staff = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'delivery', storeId: req.store._id, 'deliveryProfile.scope': 'store' },
    { active: req.body.active },
    { new: true }
  ).select('-password')
  if (!staff) return res.status(404).json({ message: 'Delivery staff member not found for this store' })
  res.json(staff)
})

export default router
