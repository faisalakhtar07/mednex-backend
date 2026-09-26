import DoctorProfile from '../models/DoctorProfile.js'

// Tenant isolation for the doctor platform — replaces the old storeAuth.js
// (multi-store marketplace has been removed). Every route that touches
// doctor-scoped data (Appointment, TokenQueue, doctor staff) must use one of
// these, not just requireRole — spec: "Doctor A must NEVER be able to access
// Doctor B's staff or appointments."

// Loads the correct DoctorProfile onto req.doctor. Must run after `protect`.
// Works for BOTH 'doctor' (owns the profile directly) and 'doctor_staff'
// (belongs to one via User.doctorId) accounts, so the same middleware can
// guard both the doctor dashboard and the staff dashboard.
export async function attachDoctor(req, res, next) {
  try {
    if (req.user.role === 'doctor') {
      const doctor = await DoctorProfile.findOne({ userId: req.user._id })
      if (!doctor) {
        return res.status(404).json({ message: 'No doctor profile found for this account. Complete doctor registration first.' })
      }
      req.doctor = doctor
    } else if (req.user.role === 'doctor_staff') {
      if (!req.user.doctorId) {
        return res.status(403).json({ message: 'This staff account is not linked to a doctor' })
      }
      const doctor = await DoctorProfile.findById(req.user.doctorId)
      if (!doctor) return res.status(404).json({ message: 'Doctor profile not found' })
      req.doctor = doctor
    } else {
      // admin / customer routes that opt into this middleware don't get an
      // implicit doctor — they must specify one explicitly (e.g. via :doctorId).
      req.doctor = null
    }
    next()
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
}

// Guards a single document lookup so a doctor/staff account can only ever
// touch rows belonging to req.doctor. Usage:
//   const appt = await requireOwnedDoc(Appointment, req.params.id, req.doctor._id, res)
//   if (!appt) return // response already sent
// Returns null (and writes the 404) when the document doesn't exist OR
// belongs to a different doctor — deliberately the same response for both,
// so one doctor's staff can't use a 403-vs-404 distinction to probe whether
// another doctor's appointment ID exists.
export async function requireOwnedDoc(Model, id, doctorId, res, notFoundMessage = 'Not found') {
  const doc = await Model.findOne({ _id: id, doctorId })
  if (!doc) {
    res.status(404).json({ message: notFoundMessage })
    return null
  }
  return doc
}

// For Super Admin routes that act on an arbitrary doctor by :doctorId param —
// just confirms the doctor exists and puts it on req.doctor for convenience.
export async function loadDoctorParam(req, res, next) {
  try {
    const doctor = await DoctorProfile.findById(req.params.doctorId)
    if (!doctor) return res.status(404).json({ message: 'Doctor not found' })
    req.doctor = doctor
    next()
  } catch (err) {
    res.status(400).json({ message: 'Invalid doctor id' })
  }
}
