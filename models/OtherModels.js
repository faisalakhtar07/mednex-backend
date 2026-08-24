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

const consultationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    doctorName: String,
    slot: String,
    fee: Number,
    status: { type: String, enum: ['Booked', 'Completed', 'Cancelled'], default: 'Booked' },
  },
  { timestamps: true }
)

export const Consultation = mongoose.model('Consultation', consultationSchema)

const prescriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Which store this prescription was uploaded to / is being fulfilled by.
    // Optional at upload time (a prescription can be attached to an order
    // afterwards) but required before a store owner can see or act on it —
    // enforced in storeAuth middleware, not just here.
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalStore', default: null, index: true },
    fileUrl: { type: String, required: true },
    fileName: String,
    status: { type: String, enum: ['Pending Review', 'Verified', 'Rejected'], default: 'Pending Review' },
  },
  { timestamps: true }
)

export const Prescription = mongoose.model('Prescription', prescriptionSchema)
