import { useCallback, useEffect, useRef, useState } from 'react'
import { allowedAttachmentTypes, isHeicImage, maxAttachmentsPerShift, prepareAttachment } from './attachmentFiles'
import {
  createAttachmentFullSizeUrl,
  createAttachmentThumbnailUrl,
  deleteShiftAttachment,
  loadAttachmentPreviewBlob,
  loadShiftAttachments,
  uploadShiftAttachment,
  type ShiftAttachment,
} from './attachments'

const action = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[#9b719a66] bg-[#30243a99] px-3 py-2 text-sm font-medium text-[#d8c8e2] transition hover:bg-[#45334f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:cursor-wait disabled:opacity-55'
type OpenPhoto = { attachment: ShiftAttachment; url: string; localPreview?: boolean }

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (/12 mb|50 mb|choose a jpeg|empty/.test(message)) return error instanceof Error ? error.message : 'Choose a supported photo.'
  if (/up to 20 photos/.test(message)) return 'A shift can have up to 20 photos. Remove a photo before adding more.'
  if (/sign in|permission|not allowed|row-level|jwt/.test(message)) return 'Photo access is unavailable. Sign in again or refresh this shift.'
  if (/network|fetch|timeout|connection/.test(message)) return 'Could not reach photo storage. Check your connection and retry.'
  if (/recovery|cleanup|pending|could not be completed/.test(message)) return error instanceof Error ? error.message.replace(/attachment [\da-f-]+/gi, 'photo') : 'Photo cleanup is still pending. Retry this photo.'
  return 'The photo could not be saved or loaded. Please retry.'
}

function PhotoThumbnail({ attachment, onOpen, onPreviewError }: { attachment: ShiftAttachment; onOpen: () => void; onPreviewError: (message: string) => void }) {
  const wrapper = useRef<HTMLButtonElement>(null)
  const [url, setUrl] = useState('')
  const [localUrl, setLocalUrl] = useState('')
  const [error, setError] = useState(false)
  const [renewal, setRenewal] = useState(0)
  const fallbackAttempted = useRef(false)
  const heic = isHeicImage(attachment.mime_type, attachment.storage_path)

  useEffect(() => () => {
    if (localUrl) URL.revokeObjectURL(localUrl)
  }, [localUrl])

  const convertForPreview = useCallback(() => {
    if (fallbackAttempted.current) {
      setError(true)
      onPreviewError('This saved iPhone photo could not be converted for preview. Its original remains stored securely.')
      return
    }
    fallbackAttempted.current = true
    void loadAttachmentPreviewBlob(attachment.storage_path, attachment.mime_type).then((blob) => {
      const objectUrl = URL.createObjectURL(blob)
      setLocalUrl(objectUrl)
      setUrl(objectUrl)
      setError(false)
    }).catch(() => {
      setError(true)
      onPreviewError('This saved iPhone photo could not be converted for preview. Its original remains stored securely.')
    })
  }, [attachment, onPreviewError])

  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    let active = true
    fallbackAttempted.current = false
    setError(false)
    setUrl('')
    const load = () => {
      void createAttachmentThumbnailUrl(attachment.storage_path, attachment.mime_type).then((value) => {
        if (active) setUrl(value)
      }).catch(() => {
        if (!active) return
        if (renewal === 0) setRenewal(1)
        else if (heic) convertForPreview()
        else setError(true)
      })
    }
    if (typeof IntersectionObserver === 'undefined') load()
    else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          load()
        }
      }, { rootMargin: '160px' })
      observer.observe(element)
      return () => { active = false; observer.disconnect() }
    }
    return () => { active = false }
  }, [attachment.storage_path, attachment.mime_type, renewal, heic, convertForPreview])

  return <button ref={wrapper} type="button" onClick={onOpen} aria-label={`Open photo ${attachment.original_filename}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-[#9b719a70] bg-[#1d1725] text-[10px] text-[#c9bfd0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2]">
    {url && !error ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => {
      if (renewal === 0) { setUrl(''); setRenewal(1) }
      else if (heic && !localUrl) convertForPreview()
      else {
        setError(true)
        if (localUrl) onPreviewError('This saved iPhone photo could not be converted for preview. Its original remains stored securely.')
      }
    }} /> : <span className="px-1">{error ? 'Preview unavailable' : 'Photo'}</span>}
  </button>
}

export function ShiftAttachments({ shiftId, userId, initialAttachments }: { shiftId: string; userId: string; initialAttachments?: ShiftAttachment[] }) {
  const [attachments, setAttachments] = useState<ShiftAttachment[]>(initialAttachments ?? [])
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [loading, setLoading] = useState(!initialAttachments)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ShiftAttachment | null>(null)
  const [openPhoto, setOpenPhoto] = useState<OpenPhoto | null>(null)
  const openPhotoRef = useRef<OpenPhoto | null>(null)
  const [openLoading, setOpenLoading] = useState(false)
  const [pendingUploads, setPendingUploads] = useState<Array<{ id: string; file: File; prepared: Awaited<ReturnType<typeof prepareAttachment>> }>>([])
  const busyLock = useRef(false)
  const takeInput = useRef<HTMLInputElement>(null)
  const chooseInput = useRef<HTMLInputElement>(null)
  const openFallbackRef = useRef(false)

  function showPhoto(photo: OpenPhoto | null) {
    openPhotoRef.current = photo
    setOpenPhoto(photo)
  }

  function closePhoto() {
    const current = openPhotoRef.current
    if (current?.localPreview) URL.revokeObjectURL(current.url)
    openPhotoRef.current = null
    setOpenPhoto(null)
  }

  useEffect(() => () => {
    const current = openPhotoRef.current
    if (current?.localPreview) URL.revokeObjectURL(current.url)
  }, [])

  async function refresh(hiddenIds: string[] = pendingUploads.map((item) => item.id)) {
    const rows = await loadShiftAttachments(shiftId)
    const hidden = new Set(hiddenIds)
    setAttachments(rows.filter((item) => !hidden.has(item.id)))
  }

  useEffect(() => {
    let active = true
    if (initialAttachments) {
      setAttachments(initialAttachments)
      setLoading(false)
      return () => { active = false }
    }
    void loadShiftAttachments(shiftId).then((items) => {
      if (active) setAttachments(items)
    }).catch((cause: unknown) => {
      if (active) setError(messageFor(cause))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [shiftId, initialAttachments])

  async function selected(files: FileList | null, input: HTMLInputElement | null) {
    if (busyLock.current) return
    setOptionsOpen(false)
    setError('')
    if (!files?.length) return
    const selectedFiles = Array.from(files)
    if (attachments.length + pendingUploads.length + selectedFiles.length > maxAttachmentsPerShift) {
      setError(`A shift can have up to ${maxAttachmentsPerShift} photos. Remove a photo before adding more.`)
      if (input) input.value = ''
      return
    }
    busyLock.current = true
    setBusy(true)
    const failures: string[] = []
    const unconfirmedIds: string[] = []
    const savedFiles: Array<{ id: string; file: File; prepared: Awaited<ReturnType<typeof prepareAttachment>> }> = []
    let uploadedCount = 0
    for (const [index, file] of selectedFiles.entries()) {
      setStatus(`Preparing photo ${index + 1} of ${selectedFiles.length}…`)
      let prepared: Awaited<ReturnType<typeof prepareAttachment>> | null = null
      const id = crypto.randomUUID()
      try {
        prepared = await prepareAttachment(file)
        if (!allowedAttachmentTypes.includes(prepared.mimeType)) throw new Error('Choose a JPEG, PNG, WebP, or HEIC photo.')
        setStatus(`Uploading photo ${index + 1} of ${selectedFiles.length}…`)
        await uploadShiftAttachment(userId, shiftId, prepared, file, id)
        uploadedCount += 1
        savedFiles.push({ id, file, prepared })
      } catch (cause) {
        failures.push(`${file.name}: ${messageFor(cause)}`)
        if (prepared) {
          const failedPrepared = prepared
          unconfirmedIds.push(id)
          setPendingUploads((items) => items.some((item) => item.id === id) ? items : [...items, { id, file, prepared: failedPrepared }])
        }
      }
    }
    try {
      await refresh([...pendingUploads.map((item) => item.id), ...unconfirmedIds])
    } catch (cause) {
      if (savedFiles.length) {
        setPendingUploads((items) => [...items, ...savedFiles.filter((saved) => !items.some((item) => item.id === saved.id))])
        failures.push('Photos may be saved, but the list could not be refreshed. Retry to confirm.')
      } else failures.push(messageFor(cause))
    }
    busyLock.current = false
    setBusy(false)
    setStatus(failures.length ? '' : uploadedCount ? `${uploadedCount === 1 ? 'Photo' : `${uploadedCount} photos`} added.` : '')
    if (failures.length) setError(failures.join(' '))
    if (input) input.value = ''
  }

  async function retryUpload(id: string) {
    if (busyLock.current) return
    const pending = pendingUploads.find((item) => item.id === id)
    if (!pending) return
    busyLock.current = true
    setBusy(true)
    setError('')
    setStatus(`Retrying ${pending.file.name}…`)
    let uploadSucceeded = false
    try {
      await uploadShiftAttachment(userId, shiftId, pending.prepared, pending.file, pending.id)
      uploadSucceeded = true
      await refresh(pendingUploads.filter((item) => item.id !== id).map((item) => item.id))
      setPendingUploads((items) => items.filter((item) => item.id !== id))
      setStatus('Photo added.')
    } catch (cause) {
      setError(uploadSucceeded ? 'Photo may be saved, but the list could not be refreshed. Retry to confirm.' : `${pending.file.name}: ${messageFor(cause)}`)
      setStatus('')
    } finally {
      busyLock.current = false
      setBusy(false)
    }
  }

  async function open(attachment: ShiftAttachment) {
    setError('')
    setOpenLoading(true)
    openFallbackRef.current = false
    try {
      const url = await createAttachmentFullSizeUrl(attachment.storage_path)
      showPhoto({ attachment, url })
    } catch (cause) {
      if (isHeicImage(attachment.mime_type, attachment.storage_path)) {
        try {
          const blob = await loadAttachmentPreviewBlob(attachment.storage_path, attachment.mime_type)
          showPhoto({ attachment, url: URL.createObjectURL(blob), localPreview: true })
        } catch {
          setError('This saved iPhone photo could not be converted for preview. Its original remains stored securely.')
        }
      } else setError(messageFor(cause))
    } finally {
      setOpenLoading(false)
    }
  }

  async function recoverOpenPhoto() {
    const current = openPhotoRef.current
    if (!current) return
    if (!isHeicImage(current.attachment.mime_type, current.attachment.storage_path) || current.localPreview) {
      setError('This photo could not be previewed in this browser. The original remains stored securely.')
      closePhoto()
      return
    }
    if (openFallbackRef.current) return
    openFallbackRef.current = true
    setOpenLoading(true)
    try {
      const blob = await loadAttachmentPreviewBlob(current.attachment.storage_path, current.attachment.mime_type)
      const latest = openPhotoRef.current
      if (!latest || latest.attachment.id !== current.attachment.id) {
        return
      }
      const url = URL.createObjectURL(blob)
      showPhoto({ attachment: latest.attachment, url, localPreview: true })
    } catch {
      setError('This saved iPhone photo could not be converted for preview. Its original remains stored securely.')
      closePhoto()
    } finally {
      openFallbackRef.current = false
      setOpenLoading(false)
    }
  }

  async function remove() {
    if (!deleteTarget || busyLock.current) return
    busyLock.current = true
    setBusy(true)
    setError('')
    try {
      await deleteShiftAttachment(deleteTarget)
      setAttachments((items) => items.filter((item) => item.id !== deleteTarget.id))
      setDeleteTarget(null)
      setStatus('Photo deleted.')
    } catch (cause) {
      setError(messageFor(cause))
      try { await refresh() } catch { /* Keep the current list visible if refresh also fails. */ }
    } finally {
      busyLock.current = false
      setBusy(false)
    }
  }

  return <section className="mt-4" aria-label="Shift attachments">
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-[#b9a9c4]">Attachments</span>
      <button type="button" className={action} disabled={busy || pendingUploads.length > 0 || attachments.length >= maxAttachmentsPerShift} aria-expanded={optionsOpen} onClick={() => { setOptionsOpen((value) => !value); setError(''); setStatus('') }}>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-4 w-4"><path d="M10 4v12M4 10h12" /></svg>
        Add photo
      </button>
      {loading ? <span role="status" className="text-xs text-[#ac9bb7]">Loading photos…</span> : null}
      {openLoading ? <span role="status" className="text-xs text-[#ac9bb7]">Opening photo…</span> : null}
      {attachments.length >= maxAttachmentsPerShift && !busy ? <span className="text-xs text-[#ac9bb7]">20 photo limit reached.</span> : null}
      {busy && status ? <span role="status" className="text-xs text-[#ac9bb7]">{status}</span> : null}
    </div>

    {optionsOpen ? <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Add a photo">
      <button type="button" className={action} disabled={busy || attachments.length >= maxAttachmentsPerShift} onClick={() => takeInput.current?.click()}>Take Photo</button>
      <button type="button" className={action} disabled={busy || attachments.length >= maxAttachmentsPerShift} onClick={() => chooseInput.current?.click()}>Choose Photo</button>
      <button type="button" className={`${action} border-transparent bg-transparent`} onClick={() => setOptionsOpen(false)}>Cancel</button>
    </div> : null}
    {pendingUploads.length ? <ul className="mt-2 space-y-2" aria-label="Photos needing upload recovery">{pendingUploads.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs text-[#c9bfd0]">
      <span className="max-w-[15rem] truncate">{item.file.name} needs saving</span>
      <button type="button" className={action} disabled={busy} onClick={() => void retryUpload(item.id)}>{busy ? 'Working…' : 'Retry photo'}</button>
    </li>)}</ul> : null}
    <input ref={takeInput} className="sr-only" type="file" accept="image/*,.heic,.heif" capture="environment" multiple aria-label="Take Photo" onChange={(event) => void selected(event.currentTarget.files, event.currentTarget)} />
    <input ref={chooseInput} className="sr-only" type="file" accept="image/*,.heic,.heif" multiple aria-label="Choose Photo" onChange={(event) => void selected(event.currentTarget.files, event.currentTarget)} />

    {attachments.length ? <div className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1" aria-label={`${attachments.length} attached ${attachments.length === 1 ? 'photo' : 'photos'}`}>
      {attachments.map((item) => <div key={item.id} className="relative shrink-0">
        <PhotoThumbnail attachment={item} onOpen={() => void open(item)} onPreviewError={setError} />
        <button type="button" className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full border border-[#e9a4bf66] bg-[#382333] text-xs text-[#f4dce9] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#f2bfd2]" aria-label={`Delete ${item.original_filename}`} disabled={busy} onClick={() => setDeleteTarget(item)}>×</button>
      </div>)}
    </div> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-[#f5bfd0]">{error}</p> : null}
    {!error && status && !busy ? <p role="status" className="mt-2 text-xs text-[#c9bfd0]">{status}</p> : null}

    {deleteTarget ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#090711dd] px-5" role="presentation"><section role="alertdialog" aria-modal="true" aria-labelledby={`delete-photo-${deleteTarget.id}`} className="w-full max-w-sm rounded-2xl border border-[#9b719a70] bg-[#261b2d] p-5 shadow-2xl">
      <h3 id={`delete-photo-${deleteTarget.id}`} className="font-serif text-2xl text-[#f4eaf7]">Delete this photo?</h3><p className="mt-2 break-all text-sm text-[#c9bfd0]">{deleteTarget.original_filename}</p>
      <div className="mt-5 flex justify-end gap-3"><button type="button" className={action} disabled={busy} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="min-h-10 rounded-xl bg-[#a34b69] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2] disabled:opacity-55" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete photo'}</button></div>
    </section></div> : null}

    {openPhoto ? <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#090711ed] p-4 sm:p-8" role="presentation" onClick={closePhoto}><section role="dialog" aria-modal="true" aria-label={`Photo ${openPhoto.attachment.original_filename}`} className="relative flex max-h-full max-w-full flex-col items-center" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="mb-3 min-h-10 self-end rounded-xl border border-[#9b719a70] bg-[#261b2d] px-4 text-sm text-[#f4eaf7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f2bfd2]" onClick={closePhoto}>Close photo</button>
      {openLoading ? <span role="status" className="mb-2 text-sm text-[#c9bfd0]">Preparing photo preview…</span> : null}
      <img src={openPhoto.url} alt={openPhoto.attachment.original_filename} className="max-h-[82dvh] max-w-full rounded-xl object-contain" onError={() => { void recoverOpenPhoto() }} />
    </section></div> : null}
  </section>
}
