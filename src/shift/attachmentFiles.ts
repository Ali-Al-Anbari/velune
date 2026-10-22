export const maxAttachmentBytes = 12 * 1024 * 1024
export const maxSourceAttachmentBytes = 50 * 1024 * 1024
export const maxAttachmentsPerShift = 20
export const allowedAttachmentTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const
const heicTypes = ['image/heic', 'image/heif']
const jpegQuality = 0.96

const extensionByType: Record<(typeof allowedAttachmentTypes)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

export type PreparedAttachment = { file: File; mimeType: (typeof allowedAttachmentTypes)[number]; extension: string }

function normalizedImageType(file: File): PreparedAttachment['mimeType'] | null {
  const type = file.type.toLowerCase()
  if (type === 'image/jpg') return 'image/jpeg'
  if (allowedAttachmentTypes.includes(type as PreparedAttachment['mimeType'])) return type as PreparedAttachment['mimeType']
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'
  return null
}

export function isHeicImage(mimeType: string, path = '') {
  return heicTypes.includes(mimeType.toLowerCase()) || /\.(heic|heif)$/i.test(path)
}

export async function convertHeicToJpeg(blob: Blob): Promise<Blob> {
  try {
    const { heicTo } = await import('heic-to')
    const jpeg = await heicTo({ blob, type: 'image/jpeg', quality: jpegQuality })
    if (!jpeg.size || jpeg.type !== 'image/jpeg') throw new Error('The converter returned an invalid JPEG.')
    return jpeg
  } catch {
    throw new Error('This iPhone photo could not be converted. Try selecting it again or choose a JPEG photo.')
  }
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  const mimeType = normalizedImageType(file)
  if (!mimeType) throw new Error('Choose a JPEG, PNG, WebP, or HEIC photo.')
  if (file.size <= 0) throw new Error('This photo is empty.')
  if (file.size > maxSourceAttachmentBytes) throw new Error('Photos must be 50 MB or smaller before compression. Choose a smaller image and retry.')

  if (isHeicImage(mimeType)) {
    const jpeg = await convertHeicToJpeg(file)
    if (jpeg.size > maxAttachmentBytes) {
      throw new Error('This photo is still over 12 MB after conversion. Choose a smaller photo; image detail was not reduced further.')
    }
    const baseName = file.name.replace(/\.(heic|heif)$/i, '') || 'photo'
    const converted = new File([jpeg], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified })
    return { file: converted, mimeType: 'image/jpeg', extension: 'jpg' }
  }

  const original = mimeType === file.type ? file : new File([file], file.name, { type: mimeType })
  const result = (prepared: File): PreparedAttachment => {
    if (prepared.size > maxAttachmentBytes) throw new Error('Photos must be 12 MB or smaller after compression. Choose a smaller image and retry.')
    return { file: prepared, mimeType, extension: extensionByType[mimeType] }
  }

  // Keep compatible JPEG/PNG/WebP files whenever they fit the bucket. HEIC/HEIF has
  // already been converted above so browser preview and Storage MIME always agree.
  if (file.size <= maxAttachmentBytes || typeof createImageBitmap === 'undefined') {
    return result(original)
  }

  try {
    const bitmap = await createImageBitmap(file)
    const longestEdge = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, 3200 / longestEdge)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return result(original)
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.96))
    if (!blob || blob.size >= file.size) return result(original)
    const compressed = new File([blob], file.name, { type: mimeType, lastModified: file.lastModified })
    return result(compressed)
  } catch {
    // Compression is an optimization; retain the original if this browser cannot decode it.
    return result(original)
  }
}
