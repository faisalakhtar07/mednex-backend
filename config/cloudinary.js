import { v2 as cloudinary } from 'cloudinary'

let configured = false

function ensureConfigured() {
  if (configured) return
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })
  configured = true
}

export function isCloudinaryConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
}

// Uploads a Buffer (from multer memoryStorage) straight to Cloudinary and
// returns the permanent https URL — this survives Render restarts/redeploys,
// unlike writing to local disk.
export function uploadBufferToCloudinary(buffer, { folder = 'mednex/prescriptions', resourceType = 'auto' } = {}) {
  ensureConfigured()
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder, resource_type: resourceType }, (err, result) => {
      if (err) return reject(err)
      resolve(result)
    })
    stream.end(buffer)
  })
}
