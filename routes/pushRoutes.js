import express from 'express'
import PushSubscription from '../models/PushSubscription.js'
import { protect } from '../middleware/auth.js'
import { isPushConfigured } from '../config/push.js'

const router = express.Router()

// GET /api/push/vapid-public-key — the frontend needs this to call
// PushManager.subscribe(). Public: it's a public key, safe to expose.
router.get('/vapid-public-key', (req, res) => {
  res.json({ configured: isPushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || null })
})

// POST /api/push/subscribe — save (or refresh) this browser's push
// subscription for the logged-in user.
router.post('/subscribe', protect, async (req, res) => {
  try {
    const { endpoint, keys } = req.body
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'Invalid push subscription' })
    }
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { user: req.user._id, endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    res.status(201).json({ message: 'Subscribed' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/push/unsubscribe — remove this browser's subscription (called
// when the user turns notifications off from Profile).
router.post('/unsubscribe', protect, async (req, res) => {
  const { endpoint } = req.body
  if (!endpoint) return res.status(400).json({ message: 'endpoint is required' })
  await PushSubscription.deleteOne({ endpoint, user: req.user._id })
  res.json({ message: 'Unsubscribed' })
})

export default router
