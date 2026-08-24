import express from 'express'
import crypto from 'crypto'
import Razorpay from 'razorpay'
import Order from '../models/Order.js'
import Subscription from '../models/Subscription.js'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import { protect, requireRole } from '../middleware/auth.js'
import { attachStore } from '../middleware/storeAuth.js'
import { notifyPayment } from '../utils/notify.js'

const router = express.Router()

function getRazorpay() {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return null
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
}

// GET /api/payments/key — frontend needs the public key id to open the Razorpay checkout widget
router.get('/key', (req, res) => {
  if (!process.env.RAZORPAY_KEY_ID) {
    return res.status(503).json({ configured: false, message: 'Razorpay is not configured on this server yet' })
  }
  res.json({ configured: true, keyId: process.env.RAZORPAY_KEY_ID })
})

// POST /api/payments/create-order — creates a Razorpay order for a MedNex order that already exists in our DB
router.post('/create-order', protect, async (req, res) => {
  try {
    const razorpay = getRazorpay()
    if (!razorpay) {
      return res.status(503).json({
        message:
          'Online payments are not set up yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the backend .env file (free test-mode keys from dashboard.razorpay.com), then restart the server.',
      })
    }

    const { orderId } = req.body
    const order = await Order.findById(orderId)
    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (String(order.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not authorized' })
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(order.total * 100), // paise
      currency: 'INR',
      receipt: order.orderNumber,
      notes: { mednexOrderId: String(order._id) },
    })

    order.razorpayOrderId = razorpayOrder.id
    await order.save()

    res.json({
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      orderNumber: order.orderNumber,
      customerName: order.address?.fullName,
      customerContact: order.address?.mobile,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/payments/verify — verifies the signature Razorpay's checkout widget returns after payment.
// This server-side check is what actually determines "Paid" — never trust the frontend alone.
router.post('/verify', protect, async (req, res) => {
  try {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const order = await Order.findById(orderId)
    if (!order) return res.status(404).json({ message: 'Order not found' })

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')

    const isValid = expectedSignature === razorpay_signature

    order.razorpayPaymentId = razorpay_payment_id
    order.razorpaySignature = razorpay_signature
    order.paymentStatus = isValid ? 'Paid' : 'Failed'
    // Payment success does NOT auto-confirm the order — the store still has
    // to confirm medicine availability first (spec section 5). Order.status
    // stays 'Pending' either way; payment and fulfilment are separate steps.
    await order.save()
    await notifyPayment(order.user, order, isValid)

    if (!isValid) return res.status(400).json({ message: 'Payment verification failed — signature mismatch', verified: false })
    res.json({ message: 'Payment verified', verified: true, order })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/payments/mark-failed — call this if the user closes/cancels the Razorpay popup
router.post('/mark-failed', protect, async (req, res) => {
  const { orderId } = req.body
  const order = await Order.findById(orderId)
  if (!order) return res.status(404).json({ message: 'Order not found' })
  order.paymentStatus = 'Failed'
  await order.save()
  await notifyPayment(order.user, order, false)
  res.json({ message: 'Marked as failed', order })
})

// --- Store subscription payments ---
// Mirrors the order-payment flow exactly (create Razorpay order -> verify
// signature server-side) because a subscription is real money too — the
// previous PUT /api/subscriptions/mine/:id/activate trusted whatever the
// client claimed it had paid, which let anyone activate for free. That
// endpoint is now disabled; this is the only way to activate a subscription.

// POST /api/payments/create-subscription-order — creates a Razorpay order
// for a pending Subscription that already exists (see POST /api/subscriptions/mine).
router.post('/create-subscription-order', protect, requireRole('owner'), attachStore, async (req, res) => {
  try {
    const razorpay = getRazorpay()
    if (!razorpay) {
      return res.status(503).json({
        message: 'Online payments are not set up yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the backend .env file, then restart the server.',
      })
    }
    const { subscriptionId } = req.body
    const subscription = await Subscription.findOne({ _id: subscriptionId, storeId: req.store._id, status: 'pending' })
    if (!subscription) return res.status(404).json({ message: 'Pending subscription not found' })
    const plan = await SubscriptionPlan.findById(subscription.planId)
    if (!plan) return res.status(404).json({ message: 'Plan no longer exists' })

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(plan.price * 100), // paise
      currency: 'INR',
      receipt: `sub_${subscription._id}`,
      notes: { mednexSubscriptionId: String(subscription._id), storeId: String(req.store._id), planName: plan.name },
    })

    subscription.paymentInformation = { ...subscription.paymentInformation, razorpayOrderId: razorpayOrder.id, amount: plan.price }
    await subscription.save()

    res.json({
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      planName: plan.name,
      storeName: req.store.storeName,
      ownerPhone: req.store.phone,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/payments/verify-subscription — verifies the Razorpay signature,
// and ONLY on a valid signature activates the subscription + the store's
// marketplace eligibility together, so the two can never drift out of sync.
router.post('/verify-subscription', protect, requireRole('owner'), attachStore, async (req, res) => {
  try {
    const { subscriptionId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const subscription = await Subscription.findOne({ _id: subscriptionId, storeId: req.store._id })
    if (!subscription) return res.status(404).json({ message: 'Subscription not found' })

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')
    const isValid = expectedSignature === razorpay_signature

    if (!isValid) {
      return res.status(400).json({ message: 'Payment verification failed — signature mismatch', verified: false })
    }

    const plan = await SubscriptionPlan.findById(subscription.planId)
    if (!plan) return res.status(404).json({ message: 'Plan no longer exists' })

    const now = new Date()
    subscription.status = 'active'
    subscription.startDate = now
    subscription.expiryDate = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000)
    subscription.paymentInformation = {
      ...subscription.paymentInformation,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      amount: plan.price,
      paidAt: now,
    }
    await subscription.save()

    req.store.subscriptionStatus = 'active'
    req.store.activeSubscriptionId = subscription._id
    await req.store.save()

    res.json({ message: 'Subscription activated', verified: true, subscription, store: req.store })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
