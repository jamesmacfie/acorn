import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../../core/server/db'
import { makeTestDb, type TestDb } from '../../../core/server/routes/testDb'
import { AgentAttachmentStore } from './attachmentStore'

let testDb: TestDb
let dataDir: string
let store: AgentAttachmentStore

beforeEach(async () => {
  testDb = makeTestDb()
  dataDir = await mkdtemp(join(tmpdir(), 'acorn-agent-objects-'))
  await testDb.db.insert(schema.tasks).values({
    id: 'task',
    title: 'Task',
    origin: 'local',
    repoOwner: 'acme',
    repoName: 'app',
    branch: 'main',
    status: 'active',
    sort: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  store = new AgentAttachmentStore(testDb.db, dataDir)
})

afterEach(async () => {
  testDb.cleanup()
  await rm(dataDir, { recursive: true, force: true })
})

describe('managed-agent attachment store', () => {
  it('deduplicates bytes while keeping filenames out of storage paths', async () => {
    const first = await store.upload('task', '../../notes.md', 'text/markdown', new TextEncoder().encode('# hello'))
    const second = await store.upload('task', 'renamed.md', 'text/markdown', new TextEncoder().encode('# hello'))
    expect(second.id).toBe(first.id)
    expect(first.filename).toBe('notes.md')
    const resolved = await store.resolve(first.id)
    expect(resolved?.localPath).not.toContain('notes.md')
  })

  it('rejects spoofed binary files and invalid UTF-8', async () => {
    await expect(store.upload('task', 'payload.exe', 'application/octet-stream', new Uint8Array([1, 2, 3])))
      .rejects.toThrow('Unsupported attachment type')
    await expect(store.upload('task', 'broken.txt', 'text/plain', new Uint8Array([0xc3, 0x28])))
      .rejects.toThrow('valid UTF-8')
  })

  it('refuses to follow a pre-existing symlink at a content address', async () => {
    const bytes = new TextEncoder().encode('safe text')
    const crypto = await import('node:crypto')
    const hash = crypto.createHash('sha256').update(bytes).digest('hex')
    const directory = join(store.root, hash.slice(0, 2))
    await import('node:fs/promises').then((fs) => fs.mkdir(directory, { recursive: true }))
    await symlink('/etc/hosts', join(directory, hash))
    await expect(store.upload('task', 'safe.txt', 'text/plain', bytes)).rejects.toThrow('regular file')
  })
})
