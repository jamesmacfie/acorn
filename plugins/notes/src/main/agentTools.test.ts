import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { notesAgentTools, type NotesToolCoreServices } from './agentTools'
import { NotesStore } from './notes'

// The agent's route to a note, pinned as the counterweight to the device gate covering plugins/memory's
// `/workspaces/:wsId/notes*` HTTP routes. Those routes were the only way a task-scoped credential could
// write a workspace or global note, and closing them is only correct if these four tools are the honest
// replacement. So this file asserts the properties that make them so:
//
//   - all three scopes are still reachable, so nothing an agent legitimately needs was taken away;
//   - the workspace is resolved from the agent's own taskId, never from a caller-supplied id, which is
//     the structural difference from `PUT /workspaces/<any-id>/notes/<slug>`;
//   - every write is stamped `author: 'agent'` with the session and origin task, which is what the
//     context assembler's sibling filter and the pane's provenance column read;
//   - `included` can't be set from here at all, since an included global note is injected into every
//     task's assembled context.
//
// Not asserted here: the permission-preference check. The projections apply that uniformly for every
// contribution, and it's covered there.

const store = (dir: string) => new NotesStore(dir)
// task-1 is in ws-1; task-orphan is in no workspace, which CoreServices.tasks.workspaceId signals by
// throwing, as the real seam does, and the 'workspace' scope has to turn that into a tool error.
const core: NotesToolCoreServices = {
  tasks: {
    workspaceId: async (taskId: string) => {
      if (taskId !== 'task-1') throw new Error('task is in no workspace')
      return 'ws-1'
    },
  } as NotesToolCoreServices['tasks'],
}
const ctx = { taskId: 'task-1', userLogin: 'james', sessionId: 'sess-9' }

describe('notes agent tools', () => {
  let dir: string
  let tools: ReturnType<typeof notesAgentTools>
  let notes: NotesStore
  const byName = (name: string) => tools.find((t) => t.name === name)!

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-notes-tools-'))
    notes = store(dir)
    tools = notesAgentTools(notes, core)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes and reads a note in all three scopes, resolving the workspace from the agent own task', async () => {
    for (const scope of ['task', 'workspace', 'global'] as const) {
      await byName('notes_write').handler({ slug: 'findings', body: `body-${scope}`, scope }, ctx)
      const read = (await byName('notes_read').handler({ slug: 'findings', scope }, ctx)) as { body: string }
      expect(read.body, scope).toContain(`body-${scope}`)
    }
    // Three separate files, one per scope directory, with the workspace one under ws-1, which the agent
    // never named. A caller-supplied workspace id isn't an input this surface has.
    expect(await notes.list({ scope: 'workspace', workspaceId: 'ws-1' })).toHaveLength(1)
    expect(await notes.list({ scope: 'global' })).toHaveLength(1)
    expect(await notes.list({ scope: 'task', taskId: 'task-1' })).toHaveLength(1)
  })

  it('stamps agent provenance on writes and appends', async () => {
    await byName('notes_write').handler({ slug: 'plan', body: 'first', scope: 'global' }, ctx)
    await byName('notes_append').handler({ slug: 'plan', text: 'second', scope: 'global' }, ctx)
    const note = await notes.read({ scope: 'global' }, 'plan')
    expect(note.author).toBe('agent')
    expect(note.originSessionId).toBe('sess-9')
    expect(note.body).toContain('first')
    expect(note.body).toContain('second')
  })

  // The property that makes the HTTP gate a confinement rather than a loss: there's no `included` input
  // on any of the four tools, so an agent can't make a global note part of every other task's prompt.
  it('exposes no way to set included', () => {
    for (const tool of tools) {
      expect(Object.keys((tool.input as unknown as { shape: Record<string, unknown> }).shape), tool.name).not.toContain('included')
    }
  })

  it('turns a task with no workspace into a tool error rather than a 500', async () => {
    await expect(byName('notes_list').handler({ scope: 'workspace' }, { ...ctx, taskId: 'task-orphan' })).rejects.toThrow(/no workspace/)
  })

  it('reports a missing note as not_found', async () => {
    await expect(byName('notes_read').handler({ slug: 'nope' }, ctx)).rejects.toThrow(/no such note/)
  })
})
