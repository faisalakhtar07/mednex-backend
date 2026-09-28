import express from 'express'
import crypto from 'crypto'
import Razorpay from 'razorpay'
import Subscription from '../models/Subscription.js'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import { protect, requireRole } from '../middleware/auth.js'
import { attachDoctor } from '../middleware/doctorAuth.js'

const router = express.Router()

// NOTE: the old order-payment endpoints (/create-order, /verify,
// /mark-failed for a medicine Order) have been removed along with the
// medical-store marketplace (Order/Product/MedicalStore). Appointment
// payments (consultation fee / QR payment) will get their own endpoints
// once the Doctor Appointment System's Appointment model exists — not
// folded into this file's old order flow.

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

// --- Doctor subscription payments ---
// Create a Razorpay order for a pending Subscription that already exists
// (see POST /api/subscriptions/mine), then verify the signature server-side
// before activating — never trust whatever the client claims it paid.

// POST /api/payments/create-subscription-order
router.post('/create-subscription-order', protect, requireRole('doctor'), attachDoctor, async (req, res) => {
  try {
    const { subscriptionId } = req.body
    const subscription = await Subscription.findOne({ _id: subscriptionId, doctorId: req.doctor._id, status: 'pending' })
    if (!subscription) return res.status(404).json({ message: 'Pending subscription not found' })
    const plan = await SubscriptionPlan.findById(subscription.planId)
    if (!plan) return res.status(404).json({ message: 'Plan no longer exists' })

    // Free plans (₹0) skip Razorpay entirely — Razorpay's API rejects
    // zero-amount orders outright, so routing a ₹0 plan through
    // orders.create() below would always fail. Activate it directly instead
    // and tell the frontend there's no checkout to open.
    if (plan.price <= 0) {
      const now = new Date()
      subscription.status = 'active'
      subscription.startDate = now
      subscription.expiryDate = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000)
      subscription.paymentInformation = { ...subscription.paymentInformation, amount: 0, paidAt: now }
      await subscription.save()
      req.doctor.subscriptionStatus = 'active'
      req.doctor.activeSubscriptionId = subscription._id
      await req.doctor.save()
      return res.json({ free: true, message: 'Free plan activated', subscription })
    }

    const razorpay = getRazorpay()
    if (!razorpay) {
      return res.status(503).json({
        message: 'Online payments are not set up yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the backend .env file, then restart the server.',
      })
    }

    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(plan.price * 100), // paise
      currency: 'INR',
      receipt: `sub_${subscription._id}`,
      notes: { mednexSubscriptionId: String(subscription._id), doctorId: String(req.doctor._id), planName: plan.name },
    })

    subscription.paymentInformation = { ...subscription.paymentInformation, razorpayOrderId: razorpayOrder.id, amount: plan.price }
    await subscription.save()

    res.json({
      free: false,
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      planName: plan.name,
      doctorName: req.doctor.name,
      doctorPhone: req.doctor.phone,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/payments/verify-subscription — verifies the Razorpay signature,
// and ONLY on a valid signature activates the subscription + the doctor's
// search eligibility together, so the two can never drift out of sync.
router.post('/verify-subscription', protect, requireRole('doctor'), attachDoctor, async (req, res) => {
  try {
    const { subscriptionId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body
    const subscription = await Subscription.findOne({ _id: subscriptionId, doctorId: req.doctor._id })
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

    req.doctor.subscriptionStatus = 'active'
    req.doctor.activeSubscriptionId = subscription._id
    await req.doctor.save()

    res.json({ message: 'Subscription activated', verified: true, subscription, doctor: req.doctor })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
