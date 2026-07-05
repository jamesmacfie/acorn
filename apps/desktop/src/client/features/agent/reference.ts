// "Add file/line to agent" quick path (docs/panes.md): format a path[:line[–line]] reference and
// drop it into the task's agent composer as a draft (the user finishes the thought and submits).
import { agentSessionsFor } from '../terminal/sessions'
import { terminalApi } from '../terminal/terminalClient'

// path · path:42 · path:42-48 (a collapsed range renders as the single line).
export function formatFileReference(path: string, startLine?: number | null, endLine?: number | null): string {
  if (startLine == null) return path
  if (endLine == null || endLine === startLine) return `${path}:${startLine}`
  const [a, b] = startLine <= endLine ? [startLine, endLine] : [endLine, startLine]
  return `${path}:${a}-${b}`
}

// Deliver as a draft to the task's most recent running agent session.
export async function sendReferenceToAgent(taskId: string, ref: string): Promise<{ ok: boolean; reason?: string }> {
  const api = terminalApi()
  if (!api) return { ok: false, reason: 'Desktop only.' }
  const target = agentSessionsFor(taskId)[0]
  if (!target) return { ok: false, reason: 'No running agent session for this task.' }
  return api.sendToAgent(target.id, ref, 'draft')
}
