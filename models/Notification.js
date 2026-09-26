import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    // Notification types: payment_success/subscription_expiring/expired
    // (billing), appointment_requested/confirmed/rejected (booking flow),
    // general (fallback). Token-queue "it's your turn" alerts are polled
    // live from GET /api/doctors/queue/:doctorId/today instead of a
    // notification row, since that state changes every few minutes.
    type: {
      type: String,
      enum: ['payment_success', 'subscription_expiring', 'subscription_expired', 'appointment_requested', 'appointment_confirmed', 'appointment_rejected', 'general'],
      default: 'general',
    },
    relatedAppointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
)

export default mongoose.model('Notification', notificationSchema)
