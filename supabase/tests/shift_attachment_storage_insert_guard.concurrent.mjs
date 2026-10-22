// Local database only: VELUNE_TEST_DATABASE_URL=postgres://...@localhost:54322/postgres \
//   node supabase/tests/shift_attachment_storage_insert_guard.concurrent.mjs
// Requires psql and all migrations. This test uses direct storage.objects writes only
// to simulate Storage's final database transaction; the application never does so.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import console from 'node:console'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { clearTimeout, setTimeout as scheduleTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'

const databaseUrl = process.env.VELUNE_TEST_DATABASE_URL
if (!databaseUrl) throw new Error('Set VELUNE_TEST_DATABASE_URL to an isolated local Supabase database.')
const host = new URL(databaseUrl).hostname
if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
  throw new Error('Concurrency tests refuse non-local databases.')
}
if (spawnSync('psql', ['--version'], { stdio: 'ignore' }).status !== 0) {
  throw new Error('psql is required for the concurrency test.')
}

const userId = randomUUID()
const shiftId = randomUUID()
const photoIds = [randomUUID(), randomUUID(), randomUUID()]
const paths = photoIds.map((id) => `${userId}/${shiftId}/${id}.jpg`)
const marker = 'velune_attachment_race_' + randomUUID().replaceAll('-', '')
const sessions = []
const quote = (value) => `'${value.replaceAll("'", "''")}'`

function psql(sql) {
  const result = spawnSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', databaseUrl, '-c', sql], {
    encoding: 'utf8', timeout: 15000,
  })
  if (result.status !== 0) throw new Error(result.stderr || `psql exited ${result.status}`)
  return result.stdout.trim()
}

function psqlAsync(sql) {
  return new Promise((resolve) => {
    const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', databaseUrl, '-c', sql])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function openSession() {
  const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', databaseUrl])
  let output = ''
  let errors = ''
  let closed = false
  const waiters = new Map()
  child.stdout.on('data', (chunk) => {
    output += chunk
    for (const [token, done] of waiters) {
      if (output.includes(token)) { waiters.delete(token); done.resolve() }
    }
  })
  child.stderr.on('data', (chunk) => { errors += chunk })
  const finished = new Promise((resolve) => child.on('close', resolve))
  child.on('close', () => {
    closed = true
    for (const [, done] of waiters) done.reject(new Error(errors || 'psql session closed'))
    waiters.clear()
  })
  const session = {
    async command(sql) {
      if (closed) throw new Error(errors || 'psql session closed')
      const token = `__velune_done_${randomUUID().replaceAll('-', '')}__`
      const complete = new Promise((resolve, reject) => {
        waiters.set(token, { resolve, reject })
      })
      child.stdin.write(`${sql}\n\\echo ${token}\n`)
      let timeout
      try {
        await Promise.race([complete, new Promise((_, reject) => {
          timeout = scheduleTimeout(() => reject(new Error('Timed out waiting for psql session')), 12000)
        })])
      } finally {
        clearTimeout(timeout)
        waiters.delete(token)
      }
      return { output, errors }
    },
    close() { if (!closed) child.stdin.end(); return finished },
  }
  sessions.push(session)
  return session
}

async function waitForBlockedQuery(applicationName) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const blocked = psql(`select count(*) from pg_stat_activity where application_name = ${quote(applicationName)} and wait_event_type = 'Lock' and state = 'active'`)
    if (blocked === '1') return
    await delay(50)
  }
  throw new Error(`${applicationName} never blocked on the attachment row; concurrency was not exercised`)
}

function addMetadata(index) {
  psql(`set request.jwt.claim.sub=${quote(userId)};
    insert into public.shift_attachments (id,user_id,shift_id,storage_path,original_filename,mime_type,file_size_bytes)
    values (${quote(photoIds[index])},${quote(userId)},${quote(shiftId)},${quote(paths[index])},'photo.jpg','image/jpeg',1000)`)
}

function storageInsert(index) {
  return `insert into storage.objects (bucket_id,name) values ('shift-attachments',${quote(paths[index])})`
}

function callerSetup(applicationName) {
  return `set application_name = ${quote(applicationName)}; set role authenticated; set request.jwt.claim.sub = ${quote(userId)};`
}

try {
  psql(`insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values (${quote(userId)},'authenticated','authenticated',${quote(`${userId}@example.test`)},'',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
    insert into public.shifts (id,user_id,started_at,ended_at) values (${quote(shiftId)},${quote(userId)},now()-interval '2 hours',now()-interval '1 hour')`)

  // Upload wins: deletion waits for the committed object and then refuses to remove metadata.
  addMetadata(0)
  const uploader = openSession()
  await uploader.command('begin;')
  await uploader.command(storageInsert(0) + ';')
  const deleteName = `${marker}_delete_waits`
  const deleting = psqlAsync(`${callerSetup(deleteName)} select public.delete_shift_attachment(${quote(photoIds[0])})`)
  await waitForBlockedQuery(deleteName)
  await uploader.command('commit;')
  uploader.close()
  const deleteResult = await deleting
  assert.notEqual(deleteResult.code, 0)
  assert.match(deleteResult.stderr, /55000.*Photo object must be deleted through Storage API first/s)
  assert.equal(psql(`select count(*) from public.shift_attachments where id=${quote(photoIds[0])}`), '1')
  assert.equal(psql(`select count(*) from storage.objects where bucket_id='shift-attachments' and name=${quote(paths[0])}`), '1')

  // Delete wins: final Storage insert waits, then rejects the missing metadata.
  addMetadata(1)
  const deleter = openSession()
  await deleter.command('begin;')
  await deleter.command(`set local role authenticated; set local request.jwt.claim.sub=${quote(userId)}; select public.delete_shift_attachment(${quote(photoIds[1])});`)
  const uploadName = `${marker}_upload_waits`
  const inserting = psqlAsync(`set application_name=${quote(uploadName)}; ${storageInsert(1)}`)
  await waitForBlockedQuery(uploadName)
  await deleter.command('commit;')
  deleter.close()
  const insertResult = await inserting
  assert.notEqual(insertResult.code, 0)
  assert.match(insertResult.stderr, /23503.*Photo metadata is no longer available/s)
  assert.equal(psql(`select count(*) from storage.objects where bucket_id='shift-attachments' and name=${quote(paths[1])}`), '0')

  // A repeatable-read deletion uses a snapshot from before upload. The row version
  // update makes the delete serialize-fail instead of overlooking the new object.
  addMetadata(2)
  const repeatableRead = openSession()
  await repeatableRead.command('begin isolation level repeatable read;')
  await repeatableRead.command(`set local role authenticated; set local request.jwt.claim.sub=${quote(userId)}; select count(*) from public.shift_attachments where id=${quote(photoIds[2])};`)
  psql(storageInsert(2))
  await assert.rejects(repeatableRead.command(`select public.delete_shift_attachment(${quote(photoIds[2])});`), /could not serialize access due to concurrent update/)
  repeatableRead.close()
  assert.equal(psql(`select count(*) from public.shift_attachments where id=${quote(photoIds[2])}`), '1')
  assert.equal(psql(`select count(*) from storage.objects where bucket_id='shift-attachments' and name=${quote(paths[2])}`), '1')
  console.log('PASS: insert wins, delete wins, and repeatable-read stale snapshot')
} finally {
  // Isolated local fixture cleanup. Production photo deletion always uses Storage API.
  await Promise.allSettled(sessions.map((session) => session.close()))
  psql(`delete from storage.objects where bucket_id='shift-attachments' and name in (${paths.map(quote).join(',')});
    delete from public.shift_attachments where id in (${photoIds.map(quote).join(',')});
    delete from public.shifts where id=${quote(shiftId)};
    delete from auth.users where id=${quote(userId)}`)
}
