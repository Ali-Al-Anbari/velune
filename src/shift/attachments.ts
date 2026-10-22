import { supabase } from '../lib/supabase'
import { convertHeicToJpeg, isHeicImage, type PreparedAttachment } from './attachmentFiles'

export const shiftAttachmentBucket = 'shift-attachments'

export type ShiftAttachment = {
  id: string
  user_id: string
  shift_id: string
  storage_path: string
  original_filename: string
  mime_type: string
  file_size_bytes: number
  created_at: string
}

function client() {
  if (!supabase) throw new Error('Photo storage is not configured on this device.')
  return supabase
}

function throwError(error: { message?: string; code?: string } | null) {
  if (error) throw error
}

function safeFilename(file: File) {
  const base = file.name.split(/[\\/]/).pop()?.trim() ?? ''
  return (base || 'photo').slice(0, 255)
}

const attachmentColumns = 'id,user_id,shift_id,storage_path,original_filename,mime_type,file_size_bytes,created_at'

async function findAttachment(id: string) {
  const { data, error } = await client().from('shift_attachments').select(attachmentColumns).eq('id', id).maybeSingle()
  throwError(error)
  return data as ShiftAttachment | null
}

async function objectExists(path: string) {
  const storage = client().storage.from(shiftAttachmentBucket)
  const parts = path.split('/')
  const filename = parts.pop()
  const folder = parts.join('/')
  if (!filename || !folder) throw new Error('The photo storage path is invalid.')
  const { data, error } = await storage.list(folder, { search: filename, limit: 100 })
  throwError(error)
  return (data ?? []).some((item) => item.name === filename)
}

async function removeObjectIfPresent(path: string) {
  const storage = client().storage.from(shiftAttachmentBucket)
  const { error } = await storage.remove([path])
  if (!error) return

  // A network response can be lost after deletion. Verify the object through Storage API before
  // deciding whether metadata can be safely removed; never query or delete storage tables in SQL.
  const parts = path.split('/')
  const filename = parts.pop()
  const folder = parts.join('/')
  if (!filename || !folder) throw error
  const { data, error: listError } = await storage.list(folder, { search: filename, limit: 100 })
  if (listError) throw error
  if ((data ?? []).some((item) => item.name === filename)) throw error
}

export async function loadShiftAttachments(shiftId: string): Promise<ShiftAttachment[]> {
  const { data, error } = await client().from('shift_attachments').select(attachmentColumns)
    .eq('shift_id', shiftId).order('created_at', { ascending: true })
  throwError(error)
  return (data ?? []) as ShiftAttachment[]
}

export async function uploadShiftAttachment(userId: string, shiftId: string, prepared: PreparedAttachment, original: File, attachmentId: string = crypto.randomUUID()) {
  const db = client()
  const id = attachmentId
  const storagePath = `${userId}/${shiftId}/${id}.${prepared.extension}`
  const metadata = {
    id,
    user_id: userId,
    shift_id: shiftId,
    storage_path: storagePath,
    original_filename: safeFilename(prepared.file.name ? prepared.file : original),
    mime_type: prepared.mimeType,
    file_size_bytes: prepared.file.size,
  }
  const { error: insertError } = await db.from('shift_attachments').insert(metadata)
  let recoveredMetadata = false
  if (insertError) {
    // Stable IDs let a retry recover when the insert committed but its response was lost.
    const existing = await findAttachment(id).catch(() => null)
    if (!existing || existing.user_id !== userId || existing.shift_id !== shiftId || existing.storage_path !== storagePath) throw insertError
    recoveredMetadata = true
  }

  try {
    // A previous upload may have completed even if its response was lost. Treat that same
    // stable object as saved instead of trying to overwrite it.
    if (recoveredMetadata && await objectExists(storagePath)) return metadata as ShiftAttachment
  } catch (cause) {
    throw new Error(`Photo upload needs recovery for attachment ${id}: ${cause instanceof Error ? cause.message : 'storage state could not be verified'}`)
  }

  const { error: uploadError } = await db.storage.from(shiftAttachmentBucket).upload(storagePath, prepared.file, {
    cacheControl: '0',
    contentType: prepared.mimeType,
    upsert: false,
  })
  if (uploadError) {
    // A successful object may have been stored even when the client lost the response.
    try {
      if (await objectExists(storagePath)) return metadata as ShiftAttachment
    } catch {
      throw new Error(`Photo upload needs recovery for attachment ${id}. Storage could not confirm whether the photo was saved. Retry this photo.`)
    }
    // No object exists, so roll back metadata only after the Storage API confirms absence.
    const { error: metadataError } = await db.rpc('delete_shift_attachment', { p_attachment_id: id })
    if (metadataError) throw new Error(`Photo upload needs recovery for attachment ${id}. Cleanup could not be completed. Retry this photo.`)
    throw uploadError
  }
  return metadata as ShiftAttachment
}

export async function createAttachmentThumbnailUrl(path: string, mimeType = '') {
  const isHeic = isHeicImage(mimeType, path)
  const { data, error } = await client().storage.from(shiftAttachmentBucket).createSignedUrl(path, 300, {
    ...(isHeic ? {} : { transform: { width: 256, height: 256, resize: 'cover' as const } }),
  })
  throwError(error)
  if (!data?.signedUrl) throw new Error('A photo preview could not be loaded.')
  return data.signedUrl
}

export async function createAttachmentFullSizeUrl(path: string) {
  const { data, error } = await client().storage.from(shiftAttachmentBucket).createSignedUrl(path, 300)
  throwError(error)
  if (!data?.signedUrl) throw new Error('The full-size photo could not be opened.')
  return data.signedUrl
}

export async function loadAttachmentPreviewBlob(path: string, mimeType: string) {
  const { data, error } = await client().storage.from(shiftAttachmentBucket).download(path)
  throwError(error)
  if (!data) throw new Error('The photo could not be downloaded for preview.')
  return isHeicImage(mimeType, path) ? convertHeicToJpeg(data) : data
}

export async function deleteShiftAttachment(attachment: Pick<ShiftAttachment, 'id' | 'storage_path'>) {
  const db = client()
  await removeObjectIfPresent(attachment.storage_path)
  const { error: metadataError } = await db.rpc('delete_shift_attachment', { p_attachment_id: attachment.id })
  throwError(metadataError)
}

export async function deleteAllShiftAttachments(shiftId: string) {
  const attachments = await loadShiftAttachments(shiftId)
  for (const attachment of attachments) await deleteShiftAttachment(attachment)
}

