// The memory plugin's agent tools, as the `tools` contribution point (docs/plugins.md § Agent
// tools and MCP).
//
// These four were defined in apps/node/src/wiring/agentToolsWiring.ts, which held this plugin's
// MemoryIndex and MemoryProposalStore in an app-level dep bag to do it. They now close over the same
// objects the plugin's own routes do, so there is one index and one proposal queue per node however the
// caller arrived.
//
// The provenance invariant is unchanged and is the reason memory_write is a WRITE tool that writes
// nothing: memory_write PROPOSES, and the human gate is the sole writer of accepted memory
// (docs/notes-and-memory.md §1). `ctx.sessionId` is transport metadata from the x-acorn-session-id
// header, stamped on the proposal so a reviewer can see which agent session asked for it.
import { z } from 'zod'
import { type AgentToolContribution, type CoreServices, ToolError } from '@acorn/plugin-api/node'
import type { MemoryIndex } from './knowledgeIpc'
import { MEMORY_TYPES, type MemoryType } from './memory'
import type { MemoryProposalStore } from './memoryProposals'

// The one core read these tools need: `tasks` is a CORE table and this plugin owns its own SQLite file,
// so the project a memory is scoped to is resolved through core rather than queried here
// (docs/data-layer.md § Plugin DBs).
type ToolCore = Pick<CoreServices, 'tasks'>

const asMemoryType = (type: string | undefined): MemoryType | undefined =>
  MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : undefined

// The memory scope key is the task's project id. A missing task is `not_found` rather than a bare failure, matching
// every other task-addressed tool on this surface.
async function projectIdFor(core: ToolCore, taskId: string): Promise<string> {
  const task = await core.tasks.load(taskId)
  if (!task) throw new ToolError('not_found', 'no such task')
  if (!task.projectId) throw new ToolError('bad_request', 'task has no project')
  return task.projectId
}

export function memoryAgentTools(index: MemoryIndex, proposals: MemoryProposalStore, core: ToolCore): AgentToolContribution[] {
  return [
    {
      name: 'memory_search',
      description: 'Search project memory (conventions, architecture, past fixes) — ranked, project-scoped.',
      input: z.object({ query: z.string(), type: z.string().optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        // Every read reconciles from the markdown files first — they are the truth, the index is derived.
        await index.reconciled()
        const { query, type } = a as { query: string; type?: string }
        return index.search(query, { projectId: await projectIdFor(core, ctx.taskId), type: asMemoryType(type) })
      },
    },
    {
      name: 'memory_list',
      description: 'The project memory index (name + description per memory).',
      input: z.object({ type: z.string().optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        await index.reconciled()
        return index.list({ projectId: await projectIdFor(core, ctx.taskId), type: asMemoryType((a as { type?: string }).type) })
      },
    },
    {
      name: 'memory_get',
      description: 'Read one memory in full (body + file path).',
      input: z.object({ name: z.string() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        await index.reconciled()
        const found = await index.get({ projectId: await projectIdFor(core, ctx.taskId), name: (a as { name: string }).name })
        if (!found) throw new ToolError('not_found', 'no such memory')
        return found
      },
    },
    {
      name: 'memory_write',
      description:
        'PROPOSE a new memory (convention/architecture/decision/fix/reference/feedback). A human reviews before it lands — nothing is written directly.',
      input: z.object({ name: z.string(), type: z.string(), description: z.string(), body: z.string() }),
      scope: 'task',
      risk: 'write',
      handler: async (a, ctx) => {
        const p = a as { name: string; type: string; description: string; body: string }
        try {
          return {
            ok: true,
            proposal: await proposals.propose({
              taskId: ctx.taskId,
              // An unresolvable task does not block the proposal: it lands unscoped and a reviewer sees
              // it, which is better than losing what the agent learned.
              projectId: await projectIdFor(core, ctx.taskId).catch(() => null),
              name: p.name,
              type: p.type as MemoryType,
              description: p.description,
              body: p.body,
              originSessionId: ctx.sessionId ?? null,
            }),
          }
        } catch (e) {
          // Propose validation (bad name/type) is the caller's fault, not a server fault.
          throw new ToolError('bad_request', e instanceof Error ? e.message : 'invalid proposal')
        }
      },
    },
  ]
}
