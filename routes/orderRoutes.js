import express from 'express'
import Order from '../models/Order.js'
import MedicalStore from '../models/MedicalStore.js'
import AdminSettings from '../models/AdminSettings.js'
import { protect, adminOnly } from '../middleware/auth.js'
import { notifyOrderStatus, notifyNewOrderToOwners } from '../utils/notify.js'
import { calculateDeliveryFee } from '../utils/commission.js'

const router = express.Router()

// POST /api/orders — place a new order (requires login). Every order is tied
// to exactly one store (spec section 8) — the cart/checkout flow on the
// frontend is expected to have already resolved storeId from the selected
// store before reaching here. We re-validate eligibility server-side so a
// stale cart can't place an order against a store that expired/got
// deactivated in the meantime. deliveryFee/total are computed here, not
// trusted from the client (spec section 30/39: server-side price
// calculation) — the client's itemTotal/discount are just for display and
// still recomputed against the actual cart total.
router.post('/', protect, async (req, res) => {
  try {
    const { storeId, items, address, discount = 0, deliveryMethod, paymentMethod, prescription, distanceKm } = req.body
    if (!items?.length) return res.status(400).json({ message: 'Cart is empty' })
    if (!storeId) return res.status(400).json({ message: 'storeId is required' })

    const store = await MedicalStore.findById(storeId)
    if (!store || !store.isMarketplaceEligible()) {
      return res.status(400).json({ message: 'This store is not currently accepting orders' })
    }

    const itemTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0)
    const settings = await AdminSettings.getSettings()
    const deliveryFee = calculateDeliveryFee(itemTotal, distanceKm ?? null, settings)
    const total = Math.max(itemTotal - discount, 0) + deliveryFee

    const orderNumber = 'MC' + Date.now().toString().slice(-8)
    const order = await Order.create({
      user: req.user._id,
      storeId,
      orderNumber,
      items,
      address,
      itemTotal,
      discount,
      deliveryFee,
      total,
      deliveryMethod,
      paymentMethod,
      paymentStatus: 'Pending',
      prescription,
    })
    await notifyOrderStatus(req.user._id, order)
    await notifyNewOrderToOwners(order)
    res.status(201).json(order)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/orders/mine — logged-in customer's own order history (across all stores)
router.get('/mine', protect, async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).populate('storeId', 'storeName logo').sort({ createdAt: -1 })
  res.json(orders)
})

// GET /api/orders/:id — the customer who placed it, that store's owner, or a platform admin.
router.get('/:id', protect, async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'name email mobile')
    .populate('storeId', 'storeName ownerId')
  if (!order) return res.status(404).json({ message: 'Order not found' })

  const isCustomer = String(order.user._id) === String(req.user._id)
  const isStoreOwner = req.user.role === 'owner' && String(order.storeId?.ownerId) === String(req.user._id)
  const isAdmin = req.user.isAdmin || req.user.role === 'admin'
  if (!isCustomer && !isStoreOwner && !isAdmin) {
    return res.status(403).json({ message: 'Not authorized to view this order' })
  }
  res.json(order)
})

// GET /api/orders — ADMIN ONLY: every order, across every store
router.get('/', protect, adminOnly, async (req, res) => {
  const orders = await Order.find({}).populate('user', 'name email mobile').populate('storeId', 'storeName').sort({ createdAt: -1 })
  res.json(orders)
})

// PUT /api/orders/:id/cancel — customer cancels their own order, only while
// it's still Pending or Confirmed (spec: "Cancel order according to order
// status" — once a rider has picked it up, cancellation must go through
// admin instead since a physical parcel is already in motion).
router.put('/:id/cancel', protect, async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
  if (!order) return res.status(404).json({ message: 'Order not found' })
  if (!['Pending', 'Confirmed'].includes(order.status)) {
    return res.status(400).json({ message: `Orders can only be cancelled while Pending or Confirmed (this one is ${order.status})` })
  }
  order.status = 'Cancelled'
  await order.save()
  await notifyOrderStatus(order.user, order)
  res.json(order)
})

export default router
