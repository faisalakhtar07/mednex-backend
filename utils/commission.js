// Every money calculation in the platform (delivery fee shown to the
// customer, what a rider earns, what a store gets paid) goes through this
// file — never inline in a route — so there's exactly one place that reads
// AdminSettings and the numbers can never drift between the order-creation
// path and the settlement path (spec section 39: "Never calculate final
// settlement only on frontend" and "do not hard-code business rules").

// Customer-facing delivery fee: free above the threshold, else tiered by
// distance. `distanceKm` is optional — until real map integration is wired
// up, callers can omit it and get the 'medium' tier as a reasonable default.
export function calculateDeliveryFee(itemTotal, distanceKm, settings) {
  if (itemTotal >= settings.freeDeliveryThreshold) return 0
  const { short, medium, long } = settings.deliveryFeeTiers
  if (distanceKm == null) return medium.fee
  if (distanceKm <= short.maxDistanceKm) return short.fee
  if (distanceKm <= medium.maxDistanceKm) return medium.fee
  return long.fee
}

// What the delivery rider earns for one delivery. Computed once at
// assignment time and frozen onto the DeliveryAssignment document — later
// admin rate changes never alter a delivery already in progress.
// Only meaningful for 'mednex' mode deliveries — 'own' mode deliveries
// never call this (their assignment's deliveryBoyEarning is hardcoded 0 in
// ownerRoutes.js, since MedNex never pays a store's own delivery staff).
export function calculateDeliveryBoyEarning(deliveryFee, distanceKm, settings) {
  let earning
  if (settings.payoutMode === 'percent') {
    earning = (deliveryFee * settings.payoutPercent) / 100
  } else {
    // 'fixed' and 'distance' both use the same tier table for now —
    // 'distance' is a placeholder for a future per-km formula (spec section
    // 7: "Higher-distance delivery → configurable").
    const { short, medium, long } = settings.payoutTiers
    if (distanceKm == null) earning = medium
    else if (distanceKm <= settings.deliveryFeeTiers.short.maxDistanceKm) earning = short
    else if (distanceKm <= settings.deliveryFeeTiers.medium.maxDistanceKm) earning = medium
    else earning = long
  }
  return Math.min(Math.max(earning, settings.minPayout), settings.maxPayout)
}

// Store settlement breakdown for one delivered order (spec sections 10 & 11).
// Two different shapes depending on which delivery system fulfilled the
// order:
//
//   'mednex' mode: itemTotal -> minus platform commission -> minus the
//   rider's MedNex-paid earning for that order -> remaining is what the
//   store is owed. The delivery fee itself was already earmarked for
//   MedNex + the rider, never passed to the store.
//
//   'own' mode: MedNex never pays a delivery person for this order (the
//   store's own staff delivered it, paid directly by the store, outside the
//   platform) — so instead of deducting a rider earning, the FULL delivery
//   fee is added on top of the store's payable, since the store needs that
//   money to cover paying their own rider themselves.
export function calculateSettlement(itemTotal, deliveryFee, deliveryBoyEarning, mode, settings) {
  const platformCommissionPercent = settings.platformCommissionPercent
  const platformCommission = Math.round((itemTotal * platformCommissionPercent) / 100)
  const settlementAmount =
    mode === 'own'
      ? Math.max(itemTotal - platformCommission + deliveryFee, 0)
      : Math.max(itemTotal - platformCommission - deliveryBoyEarning, 0)
  return { platformCommissionPercent, platformCommission, deliveryBoyEarning, settlementAmount }
}
