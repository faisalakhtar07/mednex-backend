import jwt from 'jsonwebtoken'
import User from '../models/User.js'

export async function protect(req, res, next) {
  try {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized, no token' })
    }
    const token = header.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    const user = await User.findById(decoded.id).select('-password')
    if (!user) return res.status(401).json({ message: 'User not found' })
    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, invalid token' })
  }
}

// Same as `protect`, but for public routes that behave slightly differently
// for a logged-in caller without requiring login — e.g. GET /api/stores/:id
// shows a not-yet-approved store to its own owner but 404s it for everyone
// else. Never rejects the request for missing/invalid tokens; just leaves
// req.user unset in that case.
export async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      const token = header.split(' ')[1]
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      const user = await User.findById(decoded.id).select('-password')
      if (user) req.user = user
    }
  } catch (err) {
    // invalid/expired token on an optional route — just proceed unauthenticated
  }
  next()
}

// Platform-level Super Admin only (spec section 14). This used to also allow
// 'owner' back when the app was a single pharmacy and owner === admin; now
// that stores are independent tenants, an owner must NOT get platform-wide
// access, so this checks the explicit admin role (isAdmin kept only as a
// legacy fallback for accounts created before the 'admin' role existed).
export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin' && !req.user?.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' })
  }
  next()
}

// Restricts a route to specific roles, e.g. requireRole('owner') or requireRole('owner', 'delivery').
// This is the API-level authorization check — the frontend route guard alone is not enough.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have access to this resource' })
    }
    if (req.user.active === false) {
      return res.status(403).json({ message: 'This account has been deactivated' })
    }
    next()
  }
}

export function generateToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' })
}
