import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShiftAttachment } from './attachments'
import { ShiftAttachments } from './ShiftAttachments'

const api = vi.hoisted(() => ({
  loadShiftAttachments: vi.fn(),
  uploadShiftAttachment: vi.fn(),
  createAttachmentThumbnailUrl: vi.fn(),
  createAttachmentFullSizeUrl: vi.fn(),
  loadAttachmentPreviewBlob: vi.fn(),
  deleteShiftAttachment: vi.fn(),
}))
const urls = vi.hoisted(() => ({ createObjectURL: vi.fn(), revokeObjectURL: vi.fn() }))
const files = vi.hoisted(() => ({ prepareAttachment: vi.fn() }))
vi.mock('./attachments', () => api)
vi.mock('./attachmentFiles', () => ({
  allowedAttachmentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  isHeicImage: (mimeType: string, path = '') => ['image/heic', 'image/heif'].includes(mimeType) || /\.(heic|heif)$/i.test(path),
  maxAttachmentsPerShift: 20,
  prepareAttachment: files.prepareAttachment,
}))

const saved: ShiftAttachment = {
  id: 'photo-a', user_id: 'user-a', shift_id: 'shift-a', storage_path: 'user-a/shift-a/photo-a.jpg',
  original_filename: 'receipt.jpg', mime_type: 'image/jpeg', file_size_bytes: 1200, created_at: '2026-10-21T12:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.loadShiftAttachments.mockResolvedValue([saved])
  api.uploadShiftAttachment.mockResolvedValue(saved)
  api.createAttachmentThumbnailUrl.mockResolvedValue('https://signed/thumb')
  api.createAttachmentFullSizeUrl.mockResolvedValue('https://signed/full')
  api.loadAttachmentPreviewBlob.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))
  api.deleteShiftAttachment.mockResolvedValue(undefined)
  files.prepareAttachment.mockImplementation(async (file: File) => ({ file, mimeType: 'image/jpeg', extension: 'jpg' }))
  urls.createObjectURL.mockImplementation(() => `blob:local-${urls.createObjectURL.mock.calls.length}`)
  vi.stubGlobal('URL', urls)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('shift attachments', () => {
  it.each(['active', 'completed', 'manual completed'])(
    'supports adding photos on %s shifts and associates each with that saved shift', async (kind) => {
      const shifts = { active: 'active-shift', completed: 'completed-shift', 'manual completed': 'manual-shift' }
      const shiftId = shifts[kind as keyof typeof shifts]
      const first: ShiftAttachment = { ...saved, shift_id: shiftId }
      api.loadShiftAttachments.mockResolvedValue([first])
      render(<ShiftAttachments shiftId={shiftId} userId="user-a" initialAttachments={[]} />)
      fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))
      expect(screen.getByRole('button', { name: 'Take Photo' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Choose Photo' })).toBeVisible()
      expect(screen.getByLabelText('Take Photo')).toHaveAttribute('capture', 'environment')
      expect(screen.getByLabelText('Take Photo')).toHaveAttribute('accept', 'image/*,.heic,.heif')
      expect(screen.getByLabelText('Choose Photo')).not.toHaveAttribute('capture')
      const firstFile = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' })
      const secondFile = new File(['menu'], 'menu.png', { type: 'image/png' })
      const choose = screen.getByLabelText('Choose Photo') as HTMLInputElement
      fireEvent.change(choose, { target: { files: [firstFile, secondFile] } })
      await waitFor(() => expect(api.uploadShiftAttachment).toHaveBeenCalledTimes(2))
      expect(api.uploadShiftAttachment).toHaveBeenNthCalledWith(1, 'user-a', shiftId, expect.objectContaining({ file: firstFile }), firstFile, expect.any(String))
      expect(api.uploadShiftAttachment).toHaveBeenNthCalledWith(2, 'user-a', shiftId, expect.objectContaining({ file: secondFile }), secondFile, expect.any(String))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Open photo receipt.jpg' })).toBeInTheDocument())
    },
  )

  it('shows a retryable error, preserves the attachment id, and does not report success', async () => {
    api.uploadShiftAttachment.mockRejectedValueOnce(new Error('upload unavailable')).mockResolvedValueOnce(saved)
    api.loadShiftAttachments.mockResolvedValue([])
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Choose Photo'), { target: { files: [file] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('photo.jpg: The photo could not be saved or loaded.')
    expect(screen.queryByText('Photo uploaded.')).not.toBeInTheDocument()
    const firstId = api.uploadShiftAttachment.mock.calls.at(0)?.[4]
    fireEvent.click(screen.getByRole('button', { name: 'Retry photo' }))
    await waitFor(() => expect(api.uploadShiftAttachment).toHaveBeenCalledTimes(2))
    expect(api.uploadShiftAttachment.mock.calls.at(1)?.[4]).toBe(firstId)
  })

  it('blocks duplicate file-input submissions while an upload is in flight', async () => {
    let finishUpload: ((value: ShiftAttachment) => void) | undefined
    api.uploadShiftAttachment.mockReturnValueOnce(new Promise<ShiftAttachment>((resolve) => { finishUpload = resolve }))
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add photo' }))
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })
    const choose = screen.getByLabelText('Choose Photo')
    fireEvent.change(choose, { target: { files: [file] } })
    fireEvent.change(choose, { target: { files: [file] } })
    await waitFor(() => expect(api.uploadShiftAttachment).toHaveBeenCalledOnce())
    finishUpload?.(saved)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Photo added.'))
  })

  it('opens full-size photos and handles preview failures', async () => {
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[saved]} />)
    const thumbnail = await screen.findByRole('button', { name: 'Open photo receipt.jpg' })
    fireEvent.click(thumbnail)
    const image = await screen.findByRole('dialog', { name: 'Photo receipt.jpg' })
    expect(within(image).getByRole('img', { name: 'receipt.jpg' })).toHaveAttribute('src', 'https://signed/full')
  })

  it('converts an existing HEIC thumbnail locally when native preview is unavailable', async () => {
    const heic: ShiftAttachment = { ...saved, storage_path: 'user-a/shift-a/old-photo.heic', mime_type: 'image/heic', original_filename: 'old-photo.heic' }
    api.createAttachmentThumbnailUrl.mockRejectedValueOnce(new Error('preview transform unavailable')).mockRejectedValueOnce(new Error('native preview unavailable'))
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[heic]} />)
    await waitFor(() => expect(document.querySelector('img[src="blob:local-1"]')).toBeInTheDocument())
    expect(api.createAttachmentThumbnailUrl).toHaveBeenNthCalledWith(1, heic.storage_path, heic.mime_type)
    expect(api.loadAttachmentPreviewBlob).toHaveBeenCalledWith(heic.storage_path, heic.mime_type)
  })

  it('falls back from browser HEIC preview to an authenticated local JPEG and revokes its URL', async () => {
    const heic: ShiftAttachment = { ...saved, storage_path: 'user-a/shift-a/old-photo.heic', mime_type: 'image/heic', original_filename: 'old-photo.heic' }
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[heic]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo old-photo.heic' }))
    const dialog = await screen.findByRole('dialog', { name: 'Photo old-photo.heic' })
    fireEvent.error(within(dialog).getByRole('img', { name: 'old-photo.heic' }))
    await waitFor(() => expect(within(dialog).getByRole('img', { name: 'old-photo.heic' })).toHaveAttribute('src', 'blob:local-1'))
    expect(api.loadAttachmentPreviewBlob).toHaveBeenCalledWith(heic.storage_path, heic.mime_type)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close photo' }))
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:local-1')
  })

  it('shows a clear error when an existing HEIC cannot be converted', async () => {
    const heic: ShiftAttachment = { ...saved, storage_path: 'user-a/shift-a/old-photo.heic', mime_type: 'image/heic', original_filename: 'old-photo.heic' }
    api.loadAttachmentPreviewBlob.mockRejectedValueOnce(new Error('decoder failed'))
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[heic]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo old-photo.heic' }))
    fireEvent.error(await screen.findByRole('img', { name: 'old-photo.heic' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be converted for preview')
    expect(api.deleteShiftAttachment).not.toHaveBeenCalled()
  })

  it('renews a failed signed thumbnail request and leaves a clear fallback if it remains unavailable', async () => {
    api.createAttachmentThumbnailUrl.mockRejectedValueOnce(new Error('expired signed URL')).mockResolvedValueOnce('https://signed/renewed')
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[saved]} />)
    await waitFor(() => expect(document.querySelector('img[src="https://signed/renewed"]')).toBeInTheDocument())
    expect(api.createAttachmentThumbnailUrl).toHaveBeenCalledTimes(2)
  })

  it('reports an unsupported full-size preview without deleting the saved attachment', async () => {
    api.createAttachmentFullSizeUrl.mockRejectedValueOnce(new Error('unsupported image preview'))
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[saved]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo receipt.jpg' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The photo could not be saved or loaded')
    expect(api.deleteShiftAttachment).not.toHaveBeenCalled()
  })

  it('requires confirmation before deleting a photo, then refreshes metadata', async () => {
    render(<ShiftAttachments shiftId="shift-a" userId="user-a" initialAttachments={[saved]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete receipt.jpg' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete this photo?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.deleteShiftAttachment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete receipt.jpg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete photo' }))
    await waitFor(() => expect(api.deleteShiftAttachment).toHaveBeenCalledWith(saved))
    expect(await screen.findByRole('status')).toHaveTextContent('Photo deleted.')
  })
})
