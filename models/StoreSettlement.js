import mongoose from 'mongoose'

// One StoreSettlement per delivered order — the store's payable breakdown
// (spec section 10/39). Computed once, when the order reaches 'Delivered',
// from the AdminSettings values active at that moment; never recalculated
// afterward even if commission rates change later.
const storeSettlementSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalStore', required: true, index: true },

    itemTotal: { type: Number, required: true }, // what the store is owed before any deductions
    platformCommissionPercent: { type: Number, required: true }, // snapshot of the rate used
    platformCommission: { type: Number, required: true },
    deliveryBoyEarning: { type: Number, required: true }, // deducted from the store's payable per spec section 10
    settlementAmount: { type: Number, required: true }, // itemTotal - platformCommission - deliveryBoyEarning

    status: { type: String, enum: ['pending', 'processed', 'paid', 'failed'], default: 'pending', index: true },
    paymentReference: { type: String, default: '' },
    paidAt: { type: Date, default: null },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // admin who marked it paid
  },
  { timestamps: true }
)

storeSettlementSchema.index({ storeId: 1, status: 1 })

export default mongoose.model('StoreSettlement', storeSettlementSchema)
