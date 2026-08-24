import express from 'express'
import Product from '../models/Product.js'
import MedicalStore from '../models/MedicalStore.js'
import { protect, requireRole } from '../middleware/auth.js'
import { attachStore, requireOwnedDoc } from '../middleware/storeAuth.js'

const router = express.Router()

// GET /api/products?storeId=&category=&brand=&q=&minRating=&sort=&rx=
// Customers always browse one store at a time (spec section 8), so storeId is
// required for public listing. Only a marketplace-eligible store's products
// are servable to the public; the store's own owner can pass ?includeInactive=true
// to also see inactive/out-of-stock items on their own dashboard.
router.get('/', async (req, res) => {
  try {
    const { storeId, category, brand, q, minRating, sort, rx, includeInactive } = req.query
    if (!storeId) {
      return res.status(400).json({ message: 'storeId is required — pick a store before browsing its medicines' })
    }
    const store = await MedicalStore.findById(storeId)
    if (!store) return res.status(404).json({ message: 'Store not found' })
    if (!store.isMarketplaceEligible() && includeInactive !== 'true') {
      return res.status(404).json({ message: 'This store is not currently available' })
    }

    const filter = { storeId }
    if (includeInactive !== 'true') filter.status = 'active'
    if (category) filter.category = category
    if (brand) filter.brand = brand
    if (minRating) filter.rating = { $gte: Number(minRating) }
    if (rx === 'true') filter.prescriptionRequired = true
    if (rx === 'false') filter.prescriptionRequired = false
    if (q) filter.$text = { $search: q }

    let query = Product.find(filter)
    if (sort === 'price-asc') query = query.sort({ price: 1 })
    else if (sort === 'price-desc') query = query.sort({ price: -1 })
    else if (sort === 'rating') query = query.sort({ rating: -1 })

    const products = await query.limit(500)
    res.json(products)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  const product = await Product.findById(req.params.id)
  if (!product) return res.status(404).json({ message: 'Product not found' })
  res.json(product)
})

// POST /api/products — store owner only, always created under their own store.
// storeId is taken from req.store, never trusted from the request body, so an
// owner can never create inventory under another store's id.
router.post('/', protect, requireRole('owner'), attachStore, async (req, res) => {
  try {
    const product = await Product.create({ ...req.body, storeId: req.store._id })
    res.status(201).json(product)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// PUT /api/products/:id — store owner only, and only for their own store's product.
router.put('/:id', protect, requireRole('owner'), attachStore, async (req, res) => {
  const product = await requireOwnedDoc(Product, req.params.id, req.store._id, res, 'Product not found')
  if (!product) return
  const { storeId, ...updates } = req.body // storeId can never be reassigned via this route
  Object.assign(product, updates)
  await product.save()
  res.json(product)
})

// DELETE /api/products/:id — store owner only, and only for their own store's product.
router.delete('/:id', protect, requireRole('owner'), attachStore, async (req, res) => {
  const product = await requireOwnedDoc(Product, req.params.id, req.store._id, res, 'Product not found')
  if (!product) return
  await product.deleteOne()
  res.json({ message: 'Product deleted' })
})

export default router
