import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../server/db'
import { makeTestDb, type TestDb } from '../server/routes/testDb'
import { buildAgentTools } from './agentToolsWiring'
import { NotesStore } from './notes'

describe('agent note contributions', () => {
  let testDb: TestDb
  let dir: string
  let notesStore: NotesStore

  beforeEach(async () => {
    testDb = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-agent-tools-'))
    notesStore = new NotesStore(dir)
    const now = Date.now()
    await testDb.db.insert(schema.tasks).values({
      id: 'task1', title: 'one', origin: 'local', repoOwner: 'acme', repoName: 'widget', branch: 'one', status: 'active', sort: 0, createdAt: now, updatedAt: now,
    })
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('defaults writes to task scope and stamps agent provenance', async () => {
    const tools = buildAgentTools({
      db: testDb.db,
      notesStore,
      proposals: { propose: async () => ({}) } as never,
      runtime: { targets: async () => ({ targets: [] }) } as never,
      reconciled: async () => {},
    })
    const append = tools.find((tool) => tool.name === 'notes_append')!
    const write = tools.find((tool) => tool.name === 'notes_write')!
    const context = { taskId: 'task1', userLogin: 'james', sessionId: 'session-1' }

    await append.handler({ slug: 'handoff', text: 'first' }, context)
    await write.handler({ slug: 'handoff', body: 'replaced' }, context)

    expect(await notesStore.read({ scope: 'task', taskId: 'task1' }, 'handoff')).toMatchObject({
      body: 'replaced', author: 'agent', originSessionId: 'session-1', originTaskId: 'task1',
    })
    await expect(notesStore.read({ scope: 'global' }, 'handoff')).rejects.toThrow()
  })
})
