import mongoose from 'mongoose'

const labTestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    category: { type: String, required: true, index: true },
    includes: Number,
    sample: String,
    reportTime: String,
    mrp: Number,
    price: { type: Number, required: true },
    fasting: String,
    parameters: [String],
  },
  { timestamps: true }
)

export const LabTest = mongoose.model('LabTest', labTestSchema)

const labBookingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    test: { type: mongoose.Schema.Types.ObjectId, ref: 'LabTest', required: true },
    testName: String,
    price: Number,
    status: { type: String, enum: ['Booked', 'Sample Collected', 'Report Ready', 'Cancelled'], default: 'Booked' },
  },
  { timestamps: true }
)

export const LabBooking = mongoose.model('LabBooking', labBookingSchema)

// NOTE: the old `Consultation` model (single-shot doctor booking, no staff/
// token/queue) has been removed as part of the Doctor Appointment & Token
// Queue System rebuild. Its replacement — `Appointment` — will be its own
// model file once the Doctor Appointment System is implemented.

const prescriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fileUrl: { type: String, required: true },
    fileName: String,
    status: { type: String, enum: ['Pending Review', 'Verified', 'Rejected'], default: 'Pending Review' },
  },
  { timestamps: true }
)

export const Prescription = mongoose.model('Prescription', prescriptionSchema)
