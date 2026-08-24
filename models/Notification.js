import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ['order_placed', 'order_status', 'payment_success', 'payment_failed', 'order_cancelled', 'delivery_assigned', 'subscription_expiring', 'subscription_expired', 'general'],
      default: 'general',
    },
    relatedOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
)

export default mongoose.model('Notification', notificationSchema)
