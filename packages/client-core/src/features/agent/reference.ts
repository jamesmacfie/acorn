// "Add file/line to agent" quick path (docs/panes.md): format a path[:line[–line]] reference and
// drop it into the task's agent composer as a draft (the user finishes the thought and submits).
import { Registry } from '../../kit/lib/state/registry'
import { agentSessionsFor, sendToSession } from '../tasks/agentSessions'

type ReferenceResult = { ok: boolean; reason?: string }

// A place a reference can land. `deliver` answers null when it has nowhere to put it for this task,
// and the next target gets a turn.
export type ReferenceTargetContribution = {
  id: string
  // Higher goes first. Core's fallback, the task's latest running agent session, is 0.
  priority: number
  deliver(taskId: string, reference: string): Promise<ReferenceResult | null>
}

export const referenceTargetRegistry = new Registry<ReferenceTargetContribution>('reference target')

referenceTargetRegistry.register({
  id: 'core.agent-session',
  priority: 0,
  deliver: async (taskId, reference) => {
    const target = agentSessionsFor(taskId)[0]
    return target ? sendToSession(target, reference, 'draft') : null
  },
})

// path · path:42 · path:42-48 (a collapsed range renders as the single line).
export function formatFileReference(path: string, startLine?: number | null, endLine?: number | null): string {
  if (startLine == null) return path
  if (endLine == null || endLine === startLine) return `${path}:${startLine}`
  const [a, b] = startLine <= endLine ? [startLine, endLine] : [endLine, startLine]
  return `${path}:${a}-${b}`
}

// Deliver as a draft to the first target, by priority, that takes it.
export async function sendReferenceToAgent(taskId: string, ref: string): Promise<ReferenceResult> {
  const targets = [...referenceTargetRegistry.entries()].sort((a, b) => b.priority - a.priority)
  for (const target of targets) {
    const result = await target.deliver(taskId, ref)
    if (result) return result
  }
  return { ok: false, reason: 'No running agent session for this task.' }
}
