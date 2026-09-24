// The memory plugin's agent tools, the `tools` contribution point (docs/plugins.md § Agent tools
// and MCP).
//
// Memory reads use the reconciled file index. Writes enter Findings review and require a signed
// task-scoped session supplied by the host tool route.
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type AgentToolContribution, type CoreServices, ToolError } from '@acorn/plugin-api/node'
import type { MemoryIndex } from './knowledgeChannel'
import { MEMORY_TYPES, type MemoryType } from './memory'
import { FINDINGS_AGENT_PROPOSAL, type FindingsAgentProposalCapability } from '@acorn/plugin-findings/contract/review.ts'

// The one core read these tools need: `tasks` is a core table and this plugin owns its own SQLite
// file, so the project a memory is scoped to comes through core rather than a local query
// (docs/data-layer.md § Plugin databases).
type ToolCore = Pick<CoreServices, 'tasks'>

const asMemoryType = (type: string | undefined): MemoryType | undefined =>
  MEMORY_TYPES.includes(type as MemoryType) ? (type as MemoryType) : undefined

// The memory scope key is the task's project id. A missing task is `not_found` rather than a bare
// failure, matching every other task-addressed tool on this surface.
async function projectIdFor(core: ToolCore, taskId: string): Promise<string> {
  const task = await core.tasks.load(taskId)
  if (!task) throw new ToolError('not_found', 'no such task')
  if (!task.projectId) throw new ToolError('bad_request', 'task has no project')
  return task.projectId
}

export function memoryAgentTools(index: MemoryIndex, capabilities: { get(id: typeof FINDINGS_AGENT_PROPOSAL): FindingsAgentProposalCapability | undefined }, core: ToolCore): AgentToolContribution[] {
  return [
    {
      name: 'memory_search',
      description: 'Search project memory (conventions, architecture, past fixes) — ranked, project-scoped.',
      input: z.object({ query: z.string(), type: z.string().optional() }),
      scope: 'task',
      risk: 'read',
      handler: async (a, ctx) => {
        // Every read reconciles from the markdown files first (docs/notes-and-memory.md § Memory).
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
      requiresSession: true,
      handler: async (a, ctx) => {
        const p = a as { name: string; type: string; description: string; body: string }
        if (!ctx.sessionId || !ctx.provenanceProof) throw new ToolError('failed', 'Authenticated agent session is required.')
        const findings = capabilities.get(FINDINGS_AGENT_PROPOSAL)
        if (!findings) return { ok: false, reason: 'findings_unavailable' }
        try {
          const proposal = await findings.submit({
            taskId: ctx.taskId, sessionId: ctx.sessionId, proof: ctx.provenanceProof,
            // The authenticated invocation ID makes a lost-response retry idempotent. Callers that
            // cannot supply one still get a unique proposal, but cannot retry the same operation.
            sourceKey: `memory-write:${ctx.callId ?? randomUUID()}`, title: p.name, body: p.body,
            payload: { operation: 'add', ...p, scope: { kind: 'project' } },
          })
          return { ok: true, proposal }
        } catch (e) {
          const kind = (e as { kind?: unknown }).kind
          if (kind === 'unavailable') return { ok: false, reason: 'findings_unavailable' }
          throw new ToolError(kind === 'conflict' ? 'conflict' : kind === 'invalid-input' ? 'bad_request' : 'failed', e instanceof Error ? e.message : 'proposal submission failed')
        }
      },
    },
  ]
}
