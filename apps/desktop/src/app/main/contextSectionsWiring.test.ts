import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleContext, buildContextSections, setContextSections } from '../../core/server/agentTools/contextSections'
import { schema } from '../../core/server/db'
import { makeTestDb, type TestDb } from '../../core/server/routes/testDb'
import { NotesStore } from '../../plugins/notes/main/notes'
import { wireContextSections } from './contextSectionsWiring'

describe('context section wiring', () => {
  let testDb: TestDb
  let dir: string
  let store: NotesStore

  beforeEach(async () => {
    testDb = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-context-wiring-'))
    store = new NotesStore(dir)
    const now = Date.now()
    await testDb.db.insert(schema.workspaces).values({ id: 'ws1', name: 'W', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await testDb.db.insert(schema.workspaceRepos).values({ workspaceId: 'ws1', repoOwner: 'acme', repoName: 'widget', sort: 0, createdAt: now })
    await testDb.db.insert(schema.tasks).values([
      { id: 'task1', title: 'one', origin: 'local', repoOwner: 'acme', repoName: 'widget', branch: 'one', status: 'active', sort: 0, createdAt: now, updatedAt: now },
      { id: 'task2', title: 'two', origin: 'local', repoOwner: 'acme', repoName: 'widget', branch: 'two', status: 'active', sort: 1, createdAt: now, updatedAt: now },
    ])
    wireContextSections({ db: testDb.db, notesStore: store, reconciled: async () => {} })
  })

  afterEach(() => {
    setContextSections(buildContextSections({ notes: async () => [], memory: async () => [] }))
    testDb.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('merges task, workspace and global notes without leaking sibling task notes', async () => {
    await store.append({ scope: 'task', taskId: 'task1' }, 'private-plan', 'task one', { author: 'agent' })
    await store.append({ scope: 'workspace', workspaceId: 'ws1' }, 'shared-plan', 'workspace', { author: 'user' })
    await store.append({ scope: 'global' }, 'global-plan', 'global', { author: 'user' })

    const one = await assembleContext(testDb.db, 'james', 'task1', new Set(['notes']))
    const two = await assembleContext(testDb.db, 'james', 'task2', new Set(['notes']))

    expect(one?.notes.map((note) => `${note.scope}:${note.slug}`)).toEqual(['task:private-plan', 'workspace:shared-plan', 'global:global-plan'])
    expect(two?.notes.map((note) => `${note.scope}:${note.slug}`)).toEqual(['workspace:shared-plan', 'global:global-plan'])
  })

  it('skips empty-body notes and carries note author through as provenance', async () => {
    await store.append({ scope: 'task', taskId: 'task1' }, 'agent-plan', 'from the agent', { author: 'agent' })
    await store.create({ scope: 'task', taskId: 'task1' }, 'blank', { body: '   \n' })

    const ctx = await assembleContext(testDb.db, 'james', 'task1', new Set(['notes']))
    const items = ctx?.sections.find((section) => section.id === 'notes')?.items ?? []
    expect(items.map((item) => item.id)).toEqual(['task:agent-plan'])
    expect(items[0].origin?.author).toBe('agent')
  })
})
