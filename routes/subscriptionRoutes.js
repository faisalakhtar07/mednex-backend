import express from 'express'
import SubscriptionPlan from '../models/SubscriptionPlan.js'
import Subscription from '../models/Subscription.js'
import { protect, requireRole, adminOnly } from '../middleware/auth.js'
import { attachDoctor } from '../middleware/doctorAuth.js'

const router = express.Router()

// --- Super Admin: manage plan catalog (spec section 4 — "database/configuration-driven") ---

router.get('/plans', async (req, res) => {
  // Public so the doctor onboarding flow can show plan choices before login too.
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
  // Soft-retire rather than hard delete — doctors may still reference this
  // plan on a past Subscription document.
  const plan = await SubscriptionPlan.findByIdAndUpdate(req.params.id, { status: 'inactive' }, { new: true })
  if (!plan) return res.status(404).json({ message: 'Plan not found' })
  res.json(plan)
})

// --- Doctor: subscribe / renew ---

// POST /api/subscriptions/mine — start a subscription on a chosen plan.
// This creates the Subscription record but leaves it 'pending' until payment
// confirmation activates it (see /api/payments/verify-subscription).
router.post('/mine', protect, requireRole('doctor'), attachDoctor, async (req, res) => {
  const plan = await SubscriptionPlan.findOne({ _id: req.body.planId, status: 'active' })
  if (!plan) return res.status(404).json({ message: 'Plan not found or no longer available' })
  if (plan.isFreeTrial) {
    return res.status(400).json({ message: 'Use the "Start 15-Day Free Trial" option for this plan, not regular checkout.' })
  }

  const subscription = await Subscription.create({
    doctorId: req.doctor._id,
    planId: plan._id,
    status: 'pending',
  })
  req.doctor.subscriptionStatus = 'pending'
  await req.doctor.save()
  res.status(201).json(subscription)
})

// POST /api/subscriptions/start-free-trial — one-time, 15 days, ₹0, no
// Razorpay involved at all (unlike a regular ₹0 plan, which still round-trips
// through /create-subscription-order — see paymentRoutes.js's price<=0
// bypass there). This is for brand-new doctors only: blocked once
// hasUsedFreeTrial is true, and blocked if they already have an active
// subscription (paid or trial).
router.post('/start-free-trial', protect, requireRole('doctor'), attachDoctor, async (req, res) => {
  try {
    if (req.doctor.hasUsedFreeTrial) {
      return res.status(400).json({ message: 'You have already used your free trial.' })
    }
    if (req.doctor.subscriptionStatus === 'active') {
      return res.status(400).json({ message: 'You already have an active subscription.' })
    }

    // The trial plan is system-managed, not something an admin edits from
    // the plan catalog — create it once, reuse it after. upsert avoids a
    // race if two requests hit this at the very same moment.
    const trialPlan = await SubscriptionPlan.findOneAndUpdate(
      { isFreeTrial: true },
      {
        $setOnInsert: {
          name: 'Free Trial (15 Days)',
          description: 'Try MedNex free for 15 days — no payment required.',
          price: 0,
          durationDays: 15,
          features: ['Full doctor profile listing', 'Appointment booking & token queue'],
          status: 'active',
          isFreeTrial: true,
        },
      },
      { upsert: true, new: true }
    )

    const now = new Date()
    const subscription = await Subscription.create({
      doctorId: req.doctor._id,
      planId: trialPlan._id,
      status: 'active',
      startDate: now,
      expiryDate: new Date(now.getTime() + trialPlan.durationDays * 24 * 60 * 60 * 1000),
      paymentInformation: { amount: 0, paidAt: now },
    })

    req.doctor.subscriptionStatus = 'active'
    req.doctor.activeSubscriptionId = subscription._id
    req.doctor.hasUsedFreeTrial = true
    await req.doctor.save()

    res.status(201).json({ message: '15-day free trial started', subscription })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/subscriptions/mine/:id/activate — DEPRECATED, kept only to return
// a clear error. Subscription activation now REQUIRES a verified Razorpay
// payment — see POST /api/payments/create-subscription-order and
// /api/payments/verify-subscription. This endpoint used to trust whatever
// `paymentInformation` the client sent, which meant any doctor could
// activate a subscription for free by just calling it directly — a real
// payment-bypass bug, now closed.
router.put('/mine/:id/activate', protect, requireRole('doctor'), attachDoctor, async (req, res) => {
  res.status(410).json({ message: 'This endpoint no longer activates subscriptions directly. Complete payment via /api/payments/create-subscription-order and /api/payments/verify-subscription instead.' })
})

// GET /api/subscriptions/mine — current + history for the logged-in doctor.
router.get('/mine', protect, requireRole('doctor'), attachDoctor, async (req, res) => {
  const subscriptions = await Subscription.find({ doctorId: req.doctor._id }).populate('planId').sort({ createdAt: -1 })
  res.json(subscriptions)
})

export default router
