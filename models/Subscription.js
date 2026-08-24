import mongoose from 'mongoose'

// One Subscription document per store per billing cycle. MedicalStore.subscriptionStatus
// is a denormalized copy of this document's `status`, kept in sync on every
// create/renew/expire so marketplace queries stay fast (see MedicalStore.js).
const subscriptionSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalStore', required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    startDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null, index: true },
    paymentInformation: {
      amount: Number,
      method: String,
      transactionId: String,
      paidAt: Date,
    },
  },
  { timestamps: true }
)

export default mongoose.model('Subscription', subscriptionSchema)
