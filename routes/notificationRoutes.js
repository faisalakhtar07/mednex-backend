import express from 'express'
import Notification from '../models/Notification.js'
import { protect } from '../middleware/auth.js'

const router = express.Router()

// GET /api/notifications/mine
router.get('/mine', protect, async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50)
  const unreadCount = await Notification.countDocuments({ user: req.user._id, read: false })
  res.json({ notifications, unreadCount })
})

// PUT /api/notifications/:id/read
router.put('/:id/read', protect, async (req, res) => {
  const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { read: true }, { new: true })
  if (!n) return res.status(404).json({ message: 'Notification not found' })
  res.json(n)
})

// PUT /api/notifications/read-all
router.put('/read-all', protect, async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { read: true })
  res.json({ message: 'All notifications marked as read' })
})

export default router
