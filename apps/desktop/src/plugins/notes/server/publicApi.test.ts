import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHarness, type Harness } from '../../../../test/publicApi/harness'
import { NotesStore } from '../main/notes'
import { buildNotesPublicApi } from './publicApi'

describe('notes plugin public API', () => {
  let h: Harness
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-notes-api-'))
    h = await makeHarness([{ owner: 'notes', contribution: buildNotesPublicApi(new NotesStore(dir)) }])
  })
  afterEach(() => {
    h.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const json = (method: string, path: string, body: unknown, extra: Record<string, string> = {}) =>
    h.request(`/api/v1/plugins/notes${path}`, { method, headers: { 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }, h.writeToken)
  const get = (path: string) => h.request(`/api/v1/plugins/notes${path}`, {}, h.readToken)

  it('creates, reads, optimistically writes, toggles inclusion, and deletes a global note', async () => {
    const created = await json('POST', '/global/notes', { title: 'My Note' }, { 'idempotency-key': 'n1' })
    expect(created.status).toBe(201)
    const summary = (await created.json()).data
    expect(summary.slug).toBe('my-note')
    expect(summary.version).toMatch(/^[0-9a-f]{32}$/)

    const list = (await (await get('/global/notes')).json()).data.items
    expect(list.map((n: { slug: string }) => n.slug)).toContain('my-note')

    const note = (await (await get('/global/notes/my-note')).json()).data
    expect(note.body).toBe('')

    // optimistic write: stale version → 409 file_changed
    const stale = await json('PUT', '/global/notes/my-note', { body: 'hi', expectedVersion: 'deadbeef' })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error.code).toBe('file_changed')

    const ok = await json('PUT', '/global/notes/my-note', { body: '# Hello', expectedVersion: note.version })
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.body).toBe('# Hello')

    const incl = await json('PUT', '/global/notes/my-note/included', { included: false })
    expect((await incl.json()).data.included).toBe(false)

    expect((await json('DELETE', '/global/notes/my-note', undefined)).status).toBe(204)
    expect((await get('/global/notes/my-note')).status).toBe(404)
  })

  it('scopes notes by task', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111'
    const created = await json('POST', `/tasks/${taskId}/notes`, { title: 'Task Note', kind: 'plan' }, { 'idempotency-key': 't1' })
    expect(created.status).toBe(201)
    expect((await created.json()).data.kind).toBe('plan')
    // not visible in the global collection
    expect((await (await get('/global/notes')).json()).data.items).toHaveLength(0)
    expect((await (await get(`/tasks/${taskId}/notes`)).json()).data.items).toHaveLength(1)
  })

  it('requires write scope to create a note', async () => {
    const res = await h.request('/api/v1/plugins/notes/global/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'x' },
      body: JSON.stringify({ title: 'x' }),
    }, h.readToken)
    expect(res.status).toBe(403)
  })
})
