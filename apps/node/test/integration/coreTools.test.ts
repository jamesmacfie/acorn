import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb } from '@acorn/node-core/testkit/db.ts'
import { localGitAgentTools } from '@acorn/plugin-changes/main/agentTools.ts'
import { memoryAgentTools } from '@acorn/plugin-memory/main/agentTools.ts'
import { runAgentTools } from '@acorn/plugin-terminal/main/agentTools.ts'
import { buildAgentTools } from '@acorn/node-core/server/agentTools/coreTools.ts'
import { notesAgentTools } from '@acorn/plugin-notes/main/agentTools.ts'
import { NotesStore } from '@acorn/plugin-notes/main/notes.ts'
import { browserAgentTools } from '@acorn/plugin-preview/server/agentTools.ts'

// The notes_* tools are contributed by the notes plugin. This suite pins their task-scoped default and
// agent provenance at the composition root.
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
    // `workspaceId` throws here: nothing below asks for the workspace scope, so a call to it would
    // be the bug this fails on rather than a silently different location.
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

// The manifest is assembled from core and plugin contributions. This composition-root test checks that
// every contribution reaches the assembled surface; package-level tests cover each projection.
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
    // How to write a plugin against this node, read off its own schemas so the agent never answers a
    // manifest question from memory (docs/agent-tools.md, docs/plugins.md § Teaching the agent).
    'plugin_authoring',
    // The only core tool that can change what code this node runs, and it does so by asking: it raises a
    // request the owner answers in the shell (docs/plugins.md § Approval-mediated install).
    'plugin_request',
  ]
  // Preview tools remain an Electron capability exposed through the same assembled tool manifest.
  const PREVIEW_TOOLS = ['browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_screenshot', 'browser_console']
  const CHANGES_TOOLS = ['local_changes', 'local_diff', 'git_log']
  const NOTES_TOOLS = ['notes_list', 'notes_read', 'notes_write', 'notes_append']
  const MEMORY_TOOLS = ['memory_search', 'memory_list', 'memory_get', 'memory_write']
  const TERMINAL_TOOLS = ['run_targets', 'run_start', 'run_stop', 'run_restart', 'run_status']

  it('is the same set of tool names whichever contributor declares them', () => {
    const testDb = makeTestDb()
    try {
      const core = { tasks: { load: async () => undefined } } as never
      const names = [
        ...buildAgentTools({ db: testDb.db }).map((tool) => tool.name),
        ...browserAgentTools({} as never).map((tool) => tool.name),
        ...localGitAgentTools(core).map((tool) => tool.name),
        ...memoryAgentTools({} as never, {} as never, core).map((tool) => tool.name),
        ...notesAgentTools({} as never, core).map((tool) => tool.name),
        ...runAgentTools({} as never).map((tool) => tool.name),
      ]
      // No duplicates: the registry throws on one, so a collision would break the boot, not a call.
      expect(new Set(names).size).toBe(names.length)
      expect([...names].sort()).toEqual([...CORE_TOOLS, ...CHANGES_TOOLS, ...MEMORY_TOOLS, ...NOTES_TOOLS, ...PREVIEW_TOOLS, ...TERMINAL_TOOLS].sort())
    } finally {
      testDb.cleanup()
    }
  })

  it('leaves each moved group owned by exactly one plugin', () => {
    expect(localGitAgentTools({ tasks: {} } as never).map((tool) => tool.name)).toEqual(CHANGES_TOOLS)
    expect(memoryAgentTools({} as never, {} as never, {} as never).map((tool) => tool.name)).toEqual(MEMORY_TOOLS)
    expect(notesAgentTools({} as never, {} as never).map((tool) => tool.name)).toEqual(NOTES_TOOLS)
    expect(runAgentTools({} as never).map((tool) => tool.name)).toEqual(TERMINAL_TOOLS)
    expect(browserAgentTools({} as never).map((tool) => tool.name)).toEqual(PREVIEW_TOOLS)
  })
})
