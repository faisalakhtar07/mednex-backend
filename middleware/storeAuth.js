import MedicalStore from '../models/MedicalStore.js'

// Tenant isolation for the multi-store marketplace. This is the backend
// enforcement layer referenced in spec section 16 — "Do not rely only on
// frontend hiding. Every sensitive permission must be enforced by the
// backend." Every route that touches store-scoped data (Product, Order,
// Prescription, delivery staff) must use one of these, not just requireRole.

// Loads req.user's store onto req.store. Must run after `protect`.
// Only 'owner' accounts get an implicit store now — delivery riders are
// platform-wide (see User.deliveryProfile), not tied to any one store, so
// deliveryRoutes.js doesn't use this middleware at all anymore.
// A user with no associated store (e.g. an owner who hasn't finished
// registration) is rejected here rather than leaking a null-store query
// downstream that could accidentally match everything.
export async function attachStore(req, res, next) {
  try {
    if (req.user.role === 'owner') {
      const store = await MedicalStore.findOne({ ownerId: req.user._id })
      if (!store) {
        return res.status(404).json({ message: 'No store found for this account. Complete store registration first.' })
      }
      req.store = store
    } else {
      // admin / customer routes that opt into this middleware don't get an
      // implicit store — they must specify one explicitly (e.g. via :storeId).
      req.store = null
    }
    next()
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// Guards a single document lookup so an owner/delivery account can only ever
// touch rows belonging to req.store. Usage:
//   const order = await requireOwnedDoc(Order, req.params.id, req.store._id, res)
//   if (!order) return // response already sent
// Returns null (and writes the 404) when the document doesn't exist OR
// belongs to a different store — deliberately the same response for both, so
// a store owner can't use a 403-vs-404 distinction to probe whether another
// store's order ID exists.
export async function requireOwnedDoc(Model, id, storeId, res, notFoundMessage = 'Not found') {
  const doc = await Model.findOne({ _id: id, storeId })
  if (!doc) {
    res.status(404).json({ message: notFoundMessage })
    return null
  }
  return doc
}

// For Super Admin routes that act on an arbitrary store by :storeId param —
// just confirms the store exists and puts it on req.store for convenience.
export async function loadStoreParam(req, res, next) {
  try {
    const store = await MedicalStore.findById(req.params.storeId)
    if (!store) return res.status(404).json({ message: 'Store not found' })
    req.store = store
    next()
  } catch (err) {
    res.status(400).json({ message: 'Invalid store id' })
  }
}
