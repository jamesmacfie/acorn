import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/node-core/server/routes/testDb.ts'
import * as schema from '../node/schema'
import { migrationsDir } from '../node/migrations'
import { AgentArtifactStore } from './artifactStore'

// This plugin's OWN migrated SQLite file, not core's. Deliberately not "makeTestDb with extra tables":
// a test that could still see core's schema would keep passing after this store started reading a table
// it no longer owns (server/routes/testDb.ts).
let testDb: TestPluginDb
let dataDir: string
let store: AgentArtifactStore

beforeEach(async () => {
  testDb = makeTestPluginDb('agents', migrationsDir())
  dataDir = await mkdtemp(join(tmpdir(), 'acorn-agent-artifacts-'))
  store = new AgentArtifactStore(testDb.db, dataDir)
})

afterEach(async () => {
  testDb.cleanup()
  await rm(dataDir, { recursive: true, force: true })
})

describe('managed-agent artifact store', () => {
  it('stores large output outside SQLite and serves verified metadata plus bytes', async () => {
    const text = 'command output\n'.repeat(10_000)
    const artifact = await store.putText({
      sessionId: 'session',
      turnId: 'turn',
      kind: 'command_output',
      title: '../../command.log',
      text,
    })
    const [row] = await testDb.db
      .select()
      .from(schema.agentArtifacts)
      .where(eq(schema.agentArtifacts.id, artifact.id))
    expect(row.storageKey).not.toContain('command.log')
    expect(row.metadataJson).not.toContain(text)
    const content = await store.read(artifact.id)
    expect(new TextDecoder().decode(content?.bytes)).toBe(text)
  })

  it('deduplicates object bytes and only removes the file after the final metadata row is deleted', async () => {
    const first = await store.putText({
      sessionId: 'one',
      turnId: null,
      kind: 'patch',
      title: 'one',
      text: 'same',
    })
    const second = await store.putText({
      sessionId: 'two',
      turnId: null,
      kind: 'patch',
      title: 'two',
      text: 'same',
    })
    const [firstRow, secondRow] = await Promise.all([
      testDb.db.select().from(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, first.id)).then((rows) => rows[0]!),
      testDb.db.select().from(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, second.id)).then((rows) => rows[0]!),
    ])
    await testDb.db.delete(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, first.id))
    await store.collectRemoved([firstRow])
    expect(await store.read(second.id)).not.toBeNull()
    await testDb.db.delete(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, second.id))
    await store.collectRemoved([secondRow])
    await expect(import('node:fs/promises').then((fs) => fs.readFile(join(store.root, secondRow.storageKey!))))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
