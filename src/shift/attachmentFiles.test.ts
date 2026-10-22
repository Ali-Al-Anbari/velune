import { beforeEach, describe, expect, it, vi } from 'vitest'
import { maxAttachmentBytes, maxAttachmentsPerShift, prepareAttachment } from './attachmentFiles'

const converter = vi.hoisted(() => ({ heicTo: vi.fn() }))
vi.mock('heic-to', () => converter)

beforeEach(() => {
  vi.clearAllMocks()
  converter.heicTo.mockImplementation(async () => new Blob(['converted jpeg'], { type: 'image/jpeg' }))
})

describe('shift photo validation', () => {
  it('accepts common browser image formats including HEIC selected from an iPhone', async () => {
    const jpeg = new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' })
    const prepared = await prepareAttachment(jpeg)
    expect(prepared).toMatchObject({ mimeType: 'image/jpeg', extension: 'jpg', file: jpeg })
    expect(converter.heicTo).not.toHaveBeenCalled()
    expect(maxAttachmentsPerShift).toBe(20)
    expect(maxAttachmentBytes).toBe(12 * 1024 * 1024)
  })

  it.each([
    ['image/heic', 'camera.heic'],
    ['image/heif', 'library.heif'],
  ])('converts %s to a JPEG with matching filename, MIME type, and extension', async (type, name) => {
    const source = new File(['source'], name, { type })
    const prepared = await prepareAttachment(source)
    expect(prepared).toMatchObject({ mimeType: 'image/jpeg', extension: 'jpg' })
    expect(prepared.file).toMatchObject({ name: name.replace(/\.(heic|heif)$/i, '.jpg'), type: 'image/jpeg' })
    expect(prepared.file.size).toBeGreaterThan(0)
    expect(converter.heicTo).toHaveBeenCalledWith({ blob: source, type: 'image/jpeg', quality: 0.96 })
  })

  it('rejects converted photos over the existing limit without lowering image quality silently', async () => {
    converter.heicTo.mockResolvedValueOnce(new Blob([new Uint8Array(maxAttachmentBytes + 1)], { type: 'image/jpeg' }))
    await expect(prepareAttachment(new File(['heic'], 'large.heic', { type: 'image/heic' }))).rejects.toThrow('still over 12 MB after conversion')
  })

  it('reports a clear conversion error and does not fall back to uploading HEIC bytes', async () => {
    converter.heicTo.mockRejectedValueOnce(new Error('decoder failed'))
    await expect(prepareAttachment(new File(['heic'], 'receipt.heic', { type: 'image/heic' }))).rejects.toThrow('could not be converted')
  })

  it('rejects unsupported file types clearly', async () => {
    await expect(prepareAttachment(new File(['text'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow('Choose a JPEG, PNG, WebP, or HEIC photo.')
  })

  it('rejects files larger than the documented upload limit', async () => {
    const oversized = new File([new Uint8Array(maxAttachmentBytes + 1)], 'large.jpg', { type: 'image/jpeg' })
    await expect(prepareAttachment(oversized)).rejects.toThrow('Photos must be 12 MB or smaller')
  })
})
