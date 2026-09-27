import mongoose from 'mongoose'

// One row per browser/device a user has enabled push notifications on
// (a user can have several — phone + laptop, etc.). `endpoint` is unique
// per browser subscription, so re-subscribing the same device just updates
// its keys instead of creating a duplicate row.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true }
)

export default mongoose.model('PushSubscription', pushSubscriptionSchema)
