import type { Task } from '@acorn/protocol/api.ts'
import type { NoteSummary } from '@acorn/protocol/notes.ts'

// One task and three notes, as the node would answer them. Shared by the smoke test and the capture
// script (`pnpm --filter @acorn/tui capture`), which is how the spike gets a screenshot on a machine
// with no TTY: the same tree, the same cells, printed instead of asserted.

export const TASK: Task = {
  id: 'task-1',
  title: 'fix-login',
  projectId: 'project-1',
} as Task

export const TASK_NOTES: NoteSummary[] = [
  { slug: 'scratchpad', title: 'Scratchpad', author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 0 },
  { slug: 'repro-steps', title: 'Repro steps', author: 'user', kind: 'finding', included: true, originTaskId: null, updatedAt: 0 },
  { slug: 'what-the-agent-found', title: 'What the agent found', author: 'agent', kind: 'finding', included: false, originTaskId: null, updatedAt: 0 },
]

export const WORKSPACE_NOTES: NoteSummary[] = [
  { slug: 'conventions', title: 'Conventions', author: 'user', kind: 'finding', included: true, originTaskId: null, updatedAt: 0 },
]

const BODY = '# Repro steps\n\n1. Sign in as a new account.\n2. Change the password.\n3. Sign in again — the old one still works.\n'

/** A transport that answers the routes this pane asks for and 404s the rest, so a route the pane
 *  starts asking for shows up as an empty region rather than as a silent pass. */
export function stubTransport(): { fetch: (nodeId: string, request: { path: string; method?: string }) => Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> } {
  const json = (value: unknown) => ({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify(value)),
  })
  return {
    fetch: async (_nodeId, request) => {
      const path = request.path
      if (path === '/v2/core/workspaces') return json([{ id: 'ws-1', name: 'acorn', projects: [{ id: 'project-1', name: 'acorn' }] }])
      if (path === '/v2/core/tasks') return json([TASK])
      if (path === `/v2/p/notes/tasks/${TASK.id}/notes`) return json(TASK_NOTES)
      if (path === '/v2/p/notes/workspaces/ws-1/notes') return json(WORKSPACE_NOTES)
      if (path === '/v2/p/notes/workspaces/global/notes') return json([])
      if (path.endsWith('/repro-steps')) return json({ slug: 'repro-steps', title: 'Repro steps', body: BODY, included: true })
      if (path.endsWith('/scratchpad')) return json({ slug: 'scratchpad', title: 'Scratchpad', body: 'Whatever is in hand.\n', included: true })
      return { status: 404, headers: {}, body: new Uint8Array() }
    },
  }
}
