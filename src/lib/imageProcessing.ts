import imageCompression from "browser-image-compression"

const MAX_WIDTH_OR_HEIGHT = 1280
const MAX_SIZE_MB = 1.0
const INITIAL_QUALITY = 0.8
const POST_PROCESS_LIMIT = 5 * 1024 * 1024 // 5 MB safety cap

/**
 * Process an image for upload: auto-orient via EXIF, convert to WebP,
 * and downscale to fit display needs.
 */
export async function processImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    throw new Error("Please upload a valid image file (JPEG, PNG, WebP, etc.).")
  }

  const compressed = await imageCompression(file, {
    maxWidthOrHeight: MAX_WIDTH_OR_HEIGHT,
    maxSizeMB: MAX_SIZE_MB,
    initialQuality: INITIAL_QUALITY,
    fileType: "image/webp",
    useWebWorker: true,
  })

  if (compressed.size > POST_PROCESS_LIMIT) {
    throw new Error("Image is still too large after processing. Try a smaller photo.")
  }

  const name = file.name.replace(/\.[^.]+$/, "") + ".webp"
  return new File([compressed], name, { type: "image/webp" })
}

/**
 * Rotate an image 90° clockwise and return a WebP File.
 */
export async function rotateImage90(src: string): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = "anonymous"
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("Failed to load image for rotation."))
    el.src = src
  })

  const canvas = document.createElement("canvas")
  canvas.width = img.height
  canvas.height = img.width
  const ctx = canvas.getContext("2d")!
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(img, -img.width / 2, -img.height / 2)

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas conversion failed."))),
      "image/webp",
      0.85
    )
  )

  return new File([blob], "rotated.webp", { type: "image/webp" })
}
