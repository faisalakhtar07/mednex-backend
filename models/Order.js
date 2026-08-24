import mongoose from 'mongoose'

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    brand: String,
    image: String,
    qty: { type: Number, required: true },
    price: { type: Number, required: true },
  },
  { _id: false }
)

const statusHistorySchema = new mongoose.Schema(
  {
    status: String,
    at: { type: Date, default: Date.now },
    note: String,
  },
  { _id: false }
)

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Every order belongs to exactly one store — customer carts/checkout are
    // single-store (spec section 8) so this is set once at order creation and
    // is the field every store-owner query filters on.
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'MedicalStore', required: true, index: true },
    orderNumber: { type: String, required: true, unique: true },
    items: [orderItemSchema],
    address: {
      fullName: String,
      mobile: String,
      house: String,
      street: String,
      area: String,
      city: String,
      state: String,
      pin: String,
    },
    itemTotal: Number,
    discount: Number,
    deliveryFee: Number,
    total: { type: Number, required: true },
    deliveryMethod: { type: String, enum: ['standard', 'express'], default: 'standard' },

    // --- Order fulfilment workflow ---
    // 'Pending' -> store confirms/rejects -> 'Confirmed'/'Rejected'.
    // Once a rider accepts the DeliveryAssignment this flips to 'Out for
    // Delivery'; granular pickup/enroute states live on DeliveryAssignment,
    // not here — this stays a simple status a customer/owner can read at a
    // glance (spec: owner no longer has a "Deliver Order" workflow at all).
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Rejected', 'Out for Delivery', 'Delivered', 'Cancelled'],
      default: 'Pending',
      index: true,
    },
    statusHistory: [statusHistorySchema],
    confirmedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' }, // required from the owner when they reject (e.g. "out of stock")
    // Set once the owner confirms — which delivery system fulfils this order.
    // Denormalized from DeliveryAssignment.mode for quick display without an
    // extra populate (spec section 8: dual delivery system).
    deliveryMode: { type: String, enum: [null, 'own', 'mednex'], default: null },

    // --- Payment ---
    paymentMethod: { type: String, enum: ['upi', 'card', 'netbanking', 'cod'], default: 'cod' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed'], default: 'Pending', index: true },

    // 4-digit code shown only to the customer (in-app), never to the delivery
    // rider. The rider must ask the customer for it and enter it to confirm
    // the parcel reached the right person. This is separate from the
    // DeliveryAssignment pickup code, which verifies store -> rider handoff —
    // two different handoffs, two different codes.
    deliveryOtp: { type: String, default: null },
    deliveryVerifiedAt: { type: Date, default: null },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },

    // Set once this order reaches 'Delivered' and its StoreSettlement is
    // computed — see utils/commission.js and orderRoutes.js's delivery
    // completion handler.
    settlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreSettlement', default: null },

    prescription: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription' },
  },
  { timestamps: true }
)

orderSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.statusHistory.push({ status: this.status, at: new Date() })
  }
  next()
})

orderSchema.index({ storeId: 1, status: 1 })

export default mongoose.model('Order', orderSchema)
