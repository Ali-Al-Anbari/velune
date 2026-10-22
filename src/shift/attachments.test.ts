import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteAllShiftAttachments, deleteShiftAttachment, loadAttachmentPreviewBlob, loadShiftAttachments, uploadShiftAttachment, type ShiftAttachment } from './attachments'

const db = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  createSignedUrl: vi.fn(),
  download: vi.fn(),
  heicTo: vi.fn(),
  events: [] as string[],
}))
vi.mock('heic-to', () => ({ heicTo: db.heicTo }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: db.from,
    rpc: db.rpc,
    storage: { from: () => ({ upload: db.upload, remove: db.remove, list: db.list, createSignedUrl: db.createSignedUrl, download: db.download }) },
  },
}))

const attachment: ShiftAttachment = {
  id: 'photo-id', user_id: 'user-id', shift_id: 'shift-id', storage_path: 'user-id/shift-id/photo-id.jpg',
  original_filename: 'receipt.jpg', mime_type: 'image/jpeg', file_size_bytes: 1200, created_at: '2026-10-21T12:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
  db.events.length = 0
  db.rpc.mockImplementation(async () => { db.events.push('rpc'); return { data: null, error: null } })
  db.upload.mockImplementation(async () => { db.events.push('upload'); return { data: {}, error: null } })
  db.remove.mockImplementation(async () => { db.events.push('remove'); return { data: {}, error: null } })
  db.list.mockImplementation(async () => { db.events.push('list'); return { data: [], error: null } })
  db.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'signed' }, error: null })
  db.download.mockImplementation(async () => ({ data: new Blob(['original'], { type: 'image/heic' }), error: null }))
  db.heicTo.mockImplementation(async () => new Blob(['jpeg preview'], { type: 'image/jpeg' }))
  db.from.mockImplementation(() => ({
    insert: vi.fn(async (metadata: unknown) => { db.events.push('insert'); return { data: metadata, error: null } }),
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(async () => ({ data: [attachment], error: null })),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      })),
    })),
  }))
})

describe('shift attachment Storage API', () => {
  it('inserts owner metadata before uploading to its exact shift path', async () => {
    const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' })
    const prepared = { file, mimeType: 'image/jpeg' as const, extension: 'jpg' }
    const metadata = await uploadShiftAttachment('user-id', 'shift-id', prepared, file)
    expect(db.events).toEqual(['insert', 'upload'])
    expect(db.upload).toHaveBeenCalledWith(expect.stringMatching(/^user-id\/shift-id\/[\da-f-]+\.jpg$/), file, expect.objectContaining({ contentType: 'image/jpeg', upsert: false }))
    expect(metadata).toMatchObject({ user_id: 'user-id', shift_id: 'shift-id', original_filename: 'receipt.jpg' })
  })

  it('stores converted iPhone photos as JPEG at a matching JPG path and metadata name', async () => {
    const original = new File(['heic bytes'], 'receipt.heic', { type: 'image/heic' })
    const converted = new File([new Blob(['jpeg'], { type: 'image/jpeg' })], 'receipt.jpg', { type: 'image/jpeg' })
    const prepared = { file: converted, mimeType: 'image/jpeg' as const, extension: 'jpg' }
    const result = await uploadShiftAttachment('user-id', 'shift-id', prepared, original, 'stable-id')
    expect(db.upload).toHaveBeenCalledWith('user-id/shift-id/stable-id.jpg', converted, expect.objectContaining({ contentType: 'image/jpeg', upsert: false }))
    expect(result).toMatchObject({ storage_path: 'user-id/shift-id/stable-id.jpg', mime_type: 'image/jpeg', original_filename: 'receipt.jpg' })
    expect(db.heicTo).not.toHaveBeenCalled()
  })

  it('verifies the object is absent before rolling back metadata after upload failure', async () => {
    db.upload.mockImplementationOnce(async () => { db.events.push('upload'); return { data: null, error: new Error('network lost') } })
    const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' })
    await expect(uploadShiftAttachment('user-id', 'shift-id', { file, mimeType: 'image/jpeg', extension: 'jpg' }, file)).rejects.toThrow('network lost')
    expect(db.events).toEqual(['insert', 'upload', 'list', 'rpc'])
    expect(db.rpc).toHaveBeenCalledWith('delete_shift_attachment', { p_attachment_id: expect.any(String) })
  })

  it('retains metadata when cleanup after an uncertain upload cannot be confirmed', async () => {
    db.upload.mockResolvedValueOnce({ data: null, error: new Error('network lost') })
    db.remove.mockImplementationOnce(async () => { db.events.push('remove'); return { data: null, error: new Error('storage unavailable') } })
    db.list.mockResolvedValueOnce({ data: null, error: new Error('could not verify storage state') })
    const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' })
    await expect(uploadShiftAttachment('user-id', 'shift-id', { file, mimeType: 'image/jpeg', extension: 'jpg' }, file, 'stable-photo-id')).rejects.toThrow('needs recovery')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('confirms an already-removed object through Storage API before removing metadata on retry', async () => {
    db.remove.mockImplementationOnce(async () => { db.events.push('remove'); return { data: null, error: new Error('response was lost') } })
    db.list.mockImplementationOnce(async () => { db.events.push('list'); return { data: [], error: null } })
    await deleteShiftAttachment(attachment)
    expect(db.events).toEqual(['remove', 'list', 'rpc'])
  })

  it('keeps metadata when an object still exists after a failed Storage delete', async () => {
    db.remove.mockImplementationOnce(async () => { db.events.push('remove'); return { data: null, error: new Error('storage failed') } })
    db.list.mockImplementationOnce(async () => { db.events.push('list'); return { data: [{ name: 'photo-id.jpg' }], error: null } })
    await expect(deleteShiftAttachment(attachment)).rejects.toThrow('storage failed')
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('removes the Storage object before requesting metadata deletion', async () => {
    await deleteShiftAttachment(attachment)
    expect(db.events).toEqual(['remove', 'rpc'])
    expect(db.remove).toHaveBeenCalledWith([attachment.storage_path])
    expect(db.rpc).toHaveBeenCalledWith('delete_shift_attachment', { p_attachment_id: attachment.id })
  })

  it('cleans all owned shift attachments before the shift deletion RPC can run', async () => {
    await deleteAllShiftAttachments('shift-id')
    expect(db.from).toHaveBeenCalledWith('shift_attachments')
    expect(db.events).toEqual(['remove', 'rpc'])
  })

  it('loads metadata through the owner-scoped attachment query', async () => {
    await expect(loadShiftAttachments('shift-id')).resolves.toEqual([attachment])
    expect(db.from).toHaveBeenCalledWith('shift_attachments')
  })

  it('downloads existing HEIC through authenticated Storage access and converts only for preview', async () => {
    const preview = await loadAttachmentPreviewBlob('user-id/shift-id/old.heic', 'image/heic')
    expect(db.download).toHaveBeenCalledWith('user-id/shift-id/old.heic')
    expect(db.heicTo).toHaveBeenCalledWith({ blob: expect.any(Blob), type: 'image/jpeg', quality: 0.96 })
    expect(preview).toMatchObject({ type: 'image/jpeg' })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(db.remove).not.toHaveBeenCalled()
  })

  it('preserves ordinary image downloads without conversion', async () => {
    db.download.mockResolvedValueOnce({ data: new Blob(['jpeg'], { type: 'image/jpeg' }), error: null })
    const preview = await loadAttachmentPreviewBlob('user-id/shift-id/photo.jpg', 'image/jpeg')
    expect(preview.type).toBe('image/jpeg')
    expect(db.heicTo).not.toHaveBeenCalled()
  })

  it('reuses a stable attachment id on retry after confirmed cleanup', async () => {
    const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' })
    const prepared = { file, mimeType: 'image/jpeg' as const, extension: 'jpg' }
    db.upload.mockImplementationOnce(async () => ({ data: null, error: new Error('network lost') }))
    await expect(uploadShiftAttachment('user-id', 'shift-id', prepared, file, 'stable-photo-id')).rejects.toThrow('network lost')
    await expect(uploadShiftAttachment('user-id', 'shift-id', prepared, file, 'stable-photo-id')).resolves.toMatchObject({ id: 'stable-photo-id' })
    expect(db.upload).toHaveBeenLastCalledWith('user-id/shift-id/stable-photo-id.jpg', file, expect.objectContaining({ upsert: false }))
  })

  it('treats an ambiguous upload response as successful only when the exact object exists', async () => {
    db.upload.mockImplementationOnce(async () => ({ data: null, error: new Error('network lost') }))
    db.list.mockResolvedValueOnce({ data: [{ name: 'known-photo.jpg' }], error: null })
    const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' })
    await expect(uploadShiftAttachment('user-id', 'shift-id', { file, mimeType: 'image/jpeg', extension: 'jpg' }, file, 'known-photo')).resolves.toMatchObject({
      id: 'known-photo', storage_path: 'user-id/shift-id/known-photo.jpg',
    })
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
