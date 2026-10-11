import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecretService, testCoreSeams } from '@acorn/plugin-api/testkit'
import { memoryIdentityStore } from '@acorn/plugin-api/testkit'
import { createCoreServices } from '@acorn/plugin-api/testkit'
import { makeTestDb, makeTestPluginDb, schema, type TestDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { AgentAttachmentStore } from './attachmentStore'

// Two databases, which is the point of the exercise: the attachment rows are in this plugin's file and
// the `tasks` row the upload guard checks is in core's. The store cannot join them, so the test seeds
// each through its own handle and hands the store a real CoreServices over core's.
let coreDb: TestDb
let pluginDb: TestPluginDb
let dataDir: string
let store: AgentAttachmentStore

beforeEach(async () => {
  coreDb = makeTestDb()
  pluginDb = makeTestPluginDb('agents')
  dataDir = await mkdtemp(join(tmpdir(), 'acorn-agent-objects-'))
  await coreDb.db.insert(schema.tasks).values({
    id: 'task',
    title: 'Task',
    origin: 'local',
    projectId: 'project-app',
    branch: 'main',
    status: 'active',
    sort: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  store = new AgentAttachmentStore(
    pluginDb.db,
    dataDir,
    createCoreServices({
      secrets: new SecretService('11'.repeat(32)),
      db: coreDb.db,
      activeIdentity: memoryIdentityStore(),
      ...testCoreSeams(),
    }),
  )
})

afterEach(async () => {
  pluginDb.cleanup()
  coreDb.cleanup()
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
    await expect(
      store.upload('task', 'payload.exe', 'application/octet-stream', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow('Unsupported attachment type')
    await expect(store.upload('task', 'broken.txt', 'text/plain', new Uint8Array([0xc3, 0x28]))).rejects.toThrow(
      'valid UTF-8',
    )
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

  it('copies a sent attachment into its session folder under its own name, and removes the folder with the session', async () => {
    const sent = (await store.resolve(
      (await store.upload('task', 'notes.md', 'text/markdown', new TextEncoder().encode('# hi'))).id,
    ))!
    const elsewhere = join(dataDir, 'elsewhere.md')
    await writeFile(elsewhere, 'untouched')
    const folder = store.sessionFolder('session-1')
    await store.copyToSession('session-1', sent)
    // A link left where a retry copies again is replaced, not written through.
    await rm(join(folder, sent.id, 'notes.md'))
    await symlink(elsewhere, join(folder, sent.id, 'notes.md'))
    const copy = await store.copyToSession('session-1', sent)
    expect(copy).toBe(join(folder, sent.id, 'notes.md'))
    expect(await readFile(copy, 'utf8')).toBe('# hi')
    expect(await readFile(elsewhere, 'utf8')).toBe('untouched')
    expect(await store.copyToSession('session-1', { ...sent, filename: '..' })).toBe(
      join(folder, sent.id, 'attachment'),
    )
    await store.removeSessionFolder('session-1')
    await expect(stat(folder)).rejects.toThrow()
  })
})
