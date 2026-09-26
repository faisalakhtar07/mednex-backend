import mongoose from 'mongoose'

// One booking. `tokenNumber` is assigned only once the doctor/staff CONFIRMS
// the appointment (not at request time) — so the queue only ever contains
// real, accepted patients, and token numbers stay contiguous per doctor per
// day. See DoctorProfile.currentServingToken/currentServingDate for how
// "whose turn is it" is tracked (reset automatically each day).
const appointmentSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorProfile', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Snapshotted at booking time so a later profile edit never changes what
    // the doctor/staff see on an already-placed booking.
    patientName: { type: String, required: true },
    patientPhone: { type: String, required: true },
    patientNote: { type: String, default: '' },

    // The calendar day this appointment is for, normalized to midnight UTC —
    // NOT a specific time slot (spec: token-queue system, not fixed slots).
    date: { type: Date, required: true, index: true },
    fee: { type: Number, required: true }, // consultation fee, snapshotted from DoctorProfile at booking time

    status: {
      type: String,
      enum: ['requested', 'confirmed', 'rejected', 'completed', 'cancelled', 'no_show'],
      default: 'requested',
      index: true,
    },
    // Only set once status becomes 'confirmed' — this doctor's Nth confirmed
    // booking for this specific `date`.
    tokenNumber: { type: Number, default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // the doctor or doctor_staff account that actioned it
    rejectionReason: { type: String, default: '' },

    paymentInformation: {
      method: String, // 'qr' | 'online' | 'cash_at_clinic'
      razorpayOrderId: String,
      razorpayPaymentId: String,
      amount: Number,
      paidAt: Date,
    },
  },
  { timestamps: true }
)

appointmentSchema.index({ doctorId: 1, date: 1, tokenNumber: 1 })
appointmentSchema.index({ doctorId: 1, date: 1, status: 1 })

export default mongoose.model('Appointment', appointmentSchema)
