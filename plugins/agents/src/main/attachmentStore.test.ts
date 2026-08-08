import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecretService } from '@acorn/node-core/main/core/secrets.ts'
import { memoryIdentityStore } from '@acorn/node-core/main/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/main/core/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { migrationsDir } from '../node/migrations'
import { AgentAttachmentStore } from './attachmentStore'

// TWO databases, which is the point of the exercise: the attachment rows are in this plugin's file and
// the `tasks` row the upload guard checks is in CORE's. The store cannot join them any more, so the test
// seeds each through its own handle and hands the store a real CoreServices over core's.
let coreDb: TestDb
let pluginDb: TestPluginDb
let dataDir: string
let store: AgentAttachmentStore

beforeEach(async () => {
  coreDb = makeTestDb()
  pluginDb = makeTestPluginDb('agents', migrationsDir())
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
    createCoreServices({ secrets: new SecretService('11'.repeat(32)), db: coreDb.db, activeIdentity: memoryIdentityStore() }),
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
