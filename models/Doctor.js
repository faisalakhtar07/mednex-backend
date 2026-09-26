import mongoose from 'mongoose'

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    specialization: { type: String, required: true, index: true },
    experience: String,
    rating: { type: Number, default: 4.5 },
    reviews: { type: Number, default: 0 },
    fee: { type: Number, required: true },
    availableToday: { type: Boolean, default: true },
    nextSlot: String,
    color: { type: String, default: '#0E9C90' },
    phone: { type: String, required: true },
    photo: { type: String, default: '' },
  },
  { timestamps: true }
)

export default mongoose.model('Doctor', doctorSchema)
