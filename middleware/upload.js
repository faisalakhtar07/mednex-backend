import multer from 'multer'

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  if (allowed.includes(file.mimetype)) cb(null, true)
  else cb(new Error('Only JPG, PNG, WEBP or PDF files are allowed'))
}

// Files are kept in memory only long enough to stream them to Cloudinary —
// Render's free plan wipes its local disk on every restart/redeploy, so we
// never write prescription uploads to disk here.
export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
})
