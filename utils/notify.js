import Notification from '../models/Notification.js'
import mongoose from 'mongoose'

const statusMessages = {
  Pending: { title: 'Order Placed', message: (n) => `Your order ${n} has been placed and is awaiting confirmation.`, type: 'order_placed' },
  Confirmed: { title: 'Order Confirmed', message: (n) => `Your order ${n} has been confirmed and a MedNex delivery partner will be assigned shortly.`, type: 'order_status' },
  Rejected: { title: 'Order Rejected', message: (n, order) => `Your order ${n} could not be fulfilled${order?.rejectionReason ? `: ${order.rejectionReason}` : '.'}`, type: 'order_status' },
  'Out for Delivery': {
    title: 'Out for Delivery',
    message: (n, order) => `Your order ${n} is out for delivery.${order?.deliveryOtp ? ` Share this OTP with the rider only when your order arrives: ${order.deliveryOtp}` : ''}`,
    type: 'order_status',
  },
  Delivered: { title: 'Order Delivered', message: (n) => `Your order ${n} has been delivered. Enjoy your day!`, type: 'order_status' },
  Cancelled: { title: 'Order Cancelled', message: (n) => `Your order ${n} has been cancelled.`, type: 'order_cancelled' },
}

export async function notifyOrderStatus(userId, order) {
  const entry = statusMessages[order.status]
  if (!entry) return
  await Notification.create({
    user: userId,
    title: entry.title,
    message: entry.message(order.orderNumber, order),
    type: entry.type,
    relatedOrder: order._id,
  })
}

export async function notifyPayment(userId, order, success) {
  await Notification.create({
    user: userId,
    title: success ? 'Payment Successful' : 'Payment Failed',
    message: success
      ? `Payment of ₹${order.total} for order ${order.orderNumber} was successful.`
      : `Payment for order ${order.orderNumber} failed. Please try again or choose Cash on Delivery.`,
    type: success ? 'payment_success' : 'payment_failed',
    relatedOrder: order._id,
  })
}

// Alerts ONLY that order's own store owner the moment a new order comes in —
// this is what powers the "new order" sound/badge on the Owner Dashboard.
// Deliberately scoped to order.storeId: notifying every owner on the
// platform about every order (the old single-pharmacy behavior) would leak
// one store's order volume/revenue signal to every other store's owner,
// which is exactly the kind of cross-tenant leak spec section 16 prohibits.
export async function notifyNewOrderToOwners(order) {
  const MedicalStore = mongoose.model('MedicalStore')
  const store = await MedicalStore.findById(order.storeId).select('ownerId')
  if (!store) return
  await Notification.create({
    user: store.ownerId,
    title: 'New Order Received',
    message: `${order.orderNumber} — ₹${order.total} (${order.items?.length || 0} item${order.items?.length === 1 ? '' : 's'})`,
    type: 'order_placed',
    relatedOrder: order._id,
  })
}

// Alerts one specific rider directly — used for 'own' mode (owner assigns
// their own store's rider directly, no broadcast) and for admin's manual
// reassignment of an unclaimed broadcast.
export async function notifyDeliveryAssignment(deliveryBoyId, order, storeName) {
  await Notification.create({
    user: deliveryBoyId,
    title: 'New Delivery Assignment',
    message: `Pickup from ${storeName || 'the store'} for order ${order.orderNumber}.`,
    type: 'delivery_assigned',
    relatedOrder: order._id,
  })
}

// Alerts EVERY online, approved MedNex-fleet rider at once the moment an
// order goes to 'mednex' delivery mode — this is the "broadcast" half of
// the broadcast/claim system (spec section 8: "sara log pe load
// notification jaye"). Whoever claims it first wins; this notification
// alone never assigns anything — see DeliveryAssignment.claimBroadcast.
export async function notifyBroadcastToRiders(riderIds, order, storeName) {
  if (!riderIds.length) return
  await Notification.insertMany(
    riderIds.map((riderId) => ({
      user: riderId,
      title: 'New Delivery Available',
      message: `Pickup from ${storeName || 'a store'} for order ${order.orderNumber} — first to accept gets it.`,
      type: 'delivery_assigned',
      relatedOrder: order._id,
    }))
  )
}
