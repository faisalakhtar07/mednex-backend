import express from 'express'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import Subscription from '../models/Subscription.js'
import { protect, requireRole, adminOnly } from '../middleware/auth.js'
import { attachStore } from '../middleware/storeAuth.js'

const router = express.Router()

// --- Super Admin: manage plan catalog (spec section 4 — "database/configuration-driven") ---

router.get('/plans', async (req, res) => {
  // Public so the owner onboarding flow can show plan choices before login too.
  const filter = req.query.all === 'true' ? {} : { status: 'active' }
  const plans = await SubscriptionPlan.find(filter).sort({ price: 1 })
  res.json(plans)
})

router.post('/plans', protect, adminOnly, async (req, res) => {
  try {
    const plan = await SubscriptionPlan.create(req.body)
    res.status(201).json(plan)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

router.put('/plans/:id', protect, adminOnly, async (req, res) => {
  const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, req.body, { new: true })
  if (!plan) return res.status(404).json({ message: 'Plan not found' })
  res.json(plan)
})

router.delete('/plans/:id', protect, adminOnly, async (req, res) => {
  // Soft-retire rather than hard delete — stores may still reference this
  // plan on a past Subscription document.
  const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { status: 'inactive' }, { new: true })
  if (!plan) return res.status(404).json({ message: 'Plan not found' })
  res.json(plan)
})

// --- Store owner: subscribe / renew ---

// POST /api/subscriptions/mine — start a subscription on a chosen plan.
// This creates the Subscription record but leaves it 'pending' until payment
// confirmation activates it (see /mine/activate) — mirrors how Order/payment
// flow already works elsewhere in the app (Razorpay confirm step).
router.post('/mine', protect, requireRole('owner'), attachStore, async (req, res) => {
  const plan = await SubscriptionPlan.findOne({ _id: req.body.planId, status: 'active' })
  if (!plan) return res.status(404).json({ message: 'Plan not found or no longer available' })

  const subscription = await Subscription.create({
    storeId: req.store._id,
    planId: plan._id,
    status: 'pending',
  })
  req.store.subscriptionStatus = 'pending'
  await req.store.save()
  res.status(201).json(subscription)
})

// PUT /api/subscriptions/mine/:id/activate — DEPRECATED, kept only to return
// a clear error. Subscription activation now REQUIRES a verified Razorpay
// payment — see POST /api/payments/create-subscription-order and
// /api/payments/verify-subscription. This endpoint used to trust whatever
// `paymentInformation` the client sent, which meant any store owner could
// activate a subscription for free by just calling it directly — a real
// payment-bypass bug, now closed.
router.put('/mine/:id/activate', protect, requireRole('owner'), attachStore, async (req, res) => {
  res.status(410).json({ message: 'This endpoint no longer activates subscriptions directly. Complete payment via /api/payments/create-subscription-order and /api/payments/verify-subscription instead.' })
})

// GET /api/subscriptions/mine — current + history for the logged-in owner's store.
router.get('/mine', protect, requireRole('owner'), attachStore, async (req, res) => {
  const subscriptions = await Subscription.find({ storeId: req.store._id }).populate('planId').sort({ createdAt: -1 })
  res.json(subscriptions)
})

export default router
