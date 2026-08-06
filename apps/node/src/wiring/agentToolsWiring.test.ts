import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { localGitAgentTools } from '@acorn/plugin-changes/main/agentTools.ts'
import { memoryAgentTools } from '@acorn/plugin-memory/main/agentTools.ts'
import { runAgentTools } from '@acorn/plugin-terminal/main/agentTools.ts'
import { buildAgentTools } from './agentToolsWiring'
import { notesAgentTools } from '@acorn/plugin-notes/main/agentTools.ts'
import { NotesStore } from '@acorn/plugin-notes/main/notes.ts'

// The notes_* tools moved into plugins/notes with the plugin's conversion, so this suite exercises them
// through THEIR owner rather than through the app-layer remainder. What it pins is unchanged and is the
// part that regresses silently: a write defaults to task scope, and it stamps agent provenance.
describe('agent note contributions', () => {
  let dir: string
  let notesStore: NotesStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-agent-tools-'))
    notesStore = new NotesStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('defaults writes to task scope and stamps agent provenance', async () => {
    // `workspaceId` throws here on purpose: nothing below asks for the workspace scope, so a call to it
    // would be the bug this fails on rather than a silently different location.
    const core = { tasks: { workspaceId: async () => { throw new Error('no workspace scope in this test') } } } as never
    const tools = notesAgentTools(notesStore, core)
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

// The manifest is now assembled from FIVE sources — core's remainder here plus one set per converted
// plugin — and the failure mode that makes it worth pinning is silent: a tool dropped on the way out of
// this file is invisible until an agent tries to call it and gets a 404. This suite is the only place
// that may see all five, because importing a plugin's internals is legal from an app and nowhere else.
//
// Names, not shapes: risk tiers, schemas and the three projections are covered by
// packages/node-core/src/server/routes/agentTools.test.ts and mcp/server.test.ts over a fixture.
describe('the full agent-tool manifest', () => {
  const CORE_TOOLS = [
    'task_current',
    'task_context',
    'pr_current',
    'pr_changed_files',
    'linked_issues',
    'repo_info',
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_fill',
    'browser_screenshot',
    'browser_console',
  ]
  const CHANGES_TOOLS = ['local_changes', 'local_diff', 'git_log']
  const NOTES_TOOLS = ['notes_list', 'notes_read', 'notes_write', 'notes_append']
  const MEMORY_TOOLS = ['memory_search', 'memory_list', 'memory_get', 'memory_write']
  const TERMINAL_TOOLS = ['run_targets', 'run_start', 'run_stop', 'run_restart', 'run_status']

  it('is the same set of tool names whichever contributor declares them', () => {
    const testDb = makeTestDb()
    try {
      const core = { tasks: { load: async () => undefined } } as never
      const names = [
        ...buildAgentTools({ db: testDb.db, browser: {} as never }).map((tool) => tool.name),
        ...localGitAgentTools(core).map((tool) => tool.name),
        ...memoryAgentTools({} as never, {} as never, core).map((tool) => tool.name),
        ...notesAgentTools({} as never, core).map((tool) => tool.name),
        ...runAgentTools({} as never).map((tool) => tool.name),
      ]
      // No duplicates: the registry throws on one, so a collision would break the boot, not a call.
      expect(new Set(names).size).toBe(names.length)
      expect([...names].sort()).toEqual([...CORE_TOOLS, ...CHANGES_TOOLS, ...MEMORY_TOOLS, ...NOTES_TOOLS, ...TERMINAL_TOOLS].sort())
    } finally {
      testDb.cleanup()
    }
  })

  it('leaves each moved group owned by exactly one plugin', () => {
    expect(localGitAgentTools({ tasks: {} } as never).map((tool) => tool.name)).toEqual(CHANGES_TOOLS)
    expect(memoryAgentTools({} as never, {} as never, {} as never).map((tool) => tool.name)).toEqual(MEMORY_TOOLS)
    expect(notesAgentTools({} as never, {} as never).map((tool) => tool.name)).toEqual(NOTES_TOOLS)
    expect(runAgentTools({} as never).map((tool) => tool.name)).toEqual(TERMINAL_TOOLS)
  })
})
