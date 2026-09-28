import mongoose from 'mongoose'

// One review per completed appointment (enforced via the unique index on
// appointmentId below, and by requiring the appointment's status to be
// 'completed' + not already reviewed — see routes/reviewRoutes.js). Keeping
// it 1:1 with Appointment (not just doctorId+patientId) means a patient who
// sees the same doctor many times can leave a fresh review each visit.
const reviewSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorProfile', required: true, index: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, unique: true },
    // Snapshotted so a later profile name change never rewrites old reviews.
    patientName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', trim: true, maxlength: 1000 },
  },
  { timestamps: true }
)

reviewSchema.index({ doctorId: 1, createdAt: -1 })

export default mongoose.model('Review', reviewSchema)
