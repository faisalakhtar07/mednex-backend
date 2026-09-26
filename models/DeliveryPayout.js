import mongoose from 'mongoose'

// A batch payout to one delivery rider, covering every completed
// DeliveryAssignment in a period that hasn't been paid out yet (spec
// section 12). Admin triggers this manually per rider — see
// POST /api/admin/payouts.
const deliveryPayoutSchema = new mongoose.Schema(
  {
    deliveryBoyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Every DeliveryAssignment this payout covers, so it's always traceable
    // back to individual deliveries — never just a lump number.
    assignmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryAssignment' }],
    deliveryCount: { type: Number, required: true },
    amount: { type: Number, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },
    paymentReference: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // admin who initiated it
  },
  { timestamps: true }
)

export default mongoose.model('DeliveryPayout', deliveryPayoutSchema)
