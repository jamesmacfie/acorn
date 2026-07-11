import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../../core/server/db'
import { makeHarness, type Harness } from '../../../../test/publicApi/harness'
import { editorBridge } from '../main/editor'
import { searchBridge } from '../main/search'
import { buildEditorPublicApi } from './publicApi'

// taskRoot is mocked to a temp dir; resolveInRoot stays real so path confinement is exercised.
let root: string | null = null
vi.mock('../../../core/main/taskWorktree', async (orig) => ({
  ...(await orig<typeof import('../../../core/main/taskWorktree')>()),
  taskRoot: async () => root,
}))

const TASK = '22222222-2222-4222-8222-222222222222'

describe('editor plugin public API', () => {
  let h: Harness
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-editor-api-'))
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const x = 1\n')
    root = dir
    const db = {} as AppDatabase
    h = await makeHarness([{ owner: 'editor', contribution: buildEditorPublicApi(editorBridge(db), searchBridge(db)) }])
  })
  afterEach(() => {
    root = null
    h.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const base = `/api/v1/plugins/editor/tasks/${TASK}`
  const get = (p: string) => h.request(`${base}${p}`, {}, h.readToken)
  const put = (p: string, body: unknown) =>
    h.request(`${base}${p}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, h.writeToken)

  it('lists entries and reads a file with a version', async () => {
    const rootMeta = (await (await get('/root')).json()).data
    expect(rootMeta.exists).toBe(true)

    const entries = (await (await get('/entries?path=src')).json()).data.items
    expect(entries).toEqual([{ name: 'a.ts', path: 'src/a.ts', kind: 'file' }])

    const file = (await (await get('/file?path=src/a.ts')).json()).data
    expect(file.content).toBe('export const x = 1\n')
    expect(file.version).toMatch(/^[0-9a-f]{32}$/)
    expect(file.encoding).toBe('utf8')
  })

  it('optimistically writes a file and 409s on a stale version', async () => {
    const file = (await (await get('/file?path=src/a.ts')).json()).data

    const stale = await put('/file?path=src/a.ts', { content: 'x', expectedVersion: 'deadbeef' })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error.code).toBe('file_changed')

    const ok = await put('/file?path=src/a.ts', { content: 'export const x = 2\n', expectedVersion: file.version })
    expect(ok.status).toBe(200)
    expect((await ok.json()).data.content).toBe('export const x = 2\n')

    // creating a new file with no expectedVersion succeeds
    const created = await put('/file?path=src/new.ts', { content: 'new\n' })
    expect(created.status).toBe(200)
    expect((await (await get('/file?path=src/new.ts')).json()).data.content).toBe('new\n')
  })

  it('rejects a path traversal via confinement (403/404)', async () => {
    const res = await get('/file?path=../../etc/hosts')
    // RelativePathSchema rejects a leading slash; ../ is caught by resolveInRoot → operation_forbidden
    expect([403, 422]).toContain(res.status)
  })

  it('requires write scope to write a file', async () => {
    const res = await h.request(`${base}/file?path=src/a.ts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    }, h.readToken)
    expect(res.status).toBe(403)
  })
})
