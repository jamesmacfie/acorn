// The four notes_* agent tools (docs/notes-and-memory.md § Notes covers what they do and the
// provenance they stamp). They moved here from apps/node/src/wiring/agentToolsWiring.ts once two
// blockers cleared: the NotesStore instance is this plugin's own now (published as `notes.store`,
// where plugins/memory built it before), and CoreServices gained the `tasks.workspaceId` seam the
// workspace scope needs to resolve a task's membership.
import { z } from 'zod'
import { type AgentToolContribution, type CoreServices, ToolError } from '@acorn/plugin-api/node'
import type { NoteLocation, NoteScope } from '@acorn/protocol/notes.ts'
import type { NotesStoreCapability } from '../contract/store'

// The one core read these tools need. Narrowed to `tasks` so it is obvious from the signature that a
// note tool touches core's task/workspace tables and nothing else.
export type NotesToolCoreServices = Pick<CoreServices, 'tasks'>

const scopeArg = z.enum(['task', 'workspace', 'global']).optional()

// A note scope becomes a directory, so the workspace case has to resolve the task's membership
// first. It throws when the task has no workspace, surfaced as a tool error rather than a 500,
// because "this task is not in a workspace" is an answer the agent can act on.
async function noteLocationFor(core: NotesToolCoreServices, taskId: string, scope: NoteScope = 'task'): Promise<NoteLocation> {
  if (scope === 'task') return { scope, taskId }
  if (scope === 'global') return { scope }
  try {
    return { scope, workspaceId: await core.tasks.workspaceId(taskId) }
  } catch {
    throw new ToolError('not_found', 'this task has no workspace')
  }
}

export function notesAgentTools(notes: NotesStoreCapability, core: NotesToolCoreServices): AgentToolContribution[] {
  return [
    {
      name: 'notes_list',
      description: 'Workspace notes for the current task (slug, title, kind, author).',
      input: z.object({ scope: scopeArg }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => notes.list(await noteLocationFor(core, ctx.taskId, (a as { scope?: NoteScope }).scope)),
    },
    {
      name: 'notes_read',
      description: 'Read one workspace note.',
      input: z.object({ slug: z.string(), scope: scopeArg }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        const { slug, scope } = a as { slug: string; scope?: NoteScope }
        const location = await noteLocationFor(core, ctx.taskId, scope)
        try {
          return await notes.read(location, slug)
        } catch {
          throw new ToolError('not_found', 'no such note')
        }
      },
    },
    {
      name: 'notes_write',
      description: 'Replace a note body (creates the note if missing, attributed to this agent).',
      input: z.object({ slug: z.string(), body: z.string(), scope: scopeArg }),
      scope: 'task',
      risk: 'write',
      handler: async (a, ctx) => {
        const { slug, body, scope } = a as { slug: string; body: string; scope?: NoteScope }
        const location = await noteLocationFor(core, ctx.taskId, scope)
        const writer = { author: 'agent' as const, originSessionId: ctx.sessionId, originTaskId: ctx.taskId }
        // `write` requires the file to exist to preserve its frontmatter; `append` creates it. Probing
        // first rather than always appending is what keeps a replace a replace.
        const exists = await notes.read(location, slug).catch(() => null)
        if (exists) await notes.write(location, slug, body, writer)
        else await notes.append(location, slug, body, writer)
        return { ok: true }
      },
    },
    {
      name: 'notes_append',
      description: 'Append to a note (findings, plans, handoffs) — creates it if missing, attributed to this agent.',
      input: z.object({ slug: z.string(), text: z.string(), scope: scopeArg }),
      scope: 'task',
      risk: 'write',
      handler: async (a, ctx) => {
        const { slug, text, scope } = a as { slug: string; text: string; scope?: NoteScope }
        await notes.append(await noteLocationFor(core, ctx.taskId, scope), slug, text, {
          author: 'agent',
          originSessionId: ctx.sessionId,
          originTaskId: ctx.taskId,
        })
        return { ok: true }
      },
    },
  ]
}
