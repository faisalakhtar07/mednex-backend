import mongoose from 'mongoose'

// One Subscription document per doctor per billing cycle. DoctorProfile.subscriptionStatus
// is a denormalized copy of this document's `status`, kept in sync on every
// create/renew/expire so search queries stay fast (see DoctorProfile.js).
const subscriptionSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorProfile', required: true, index: true },
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
