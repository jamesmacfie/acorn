// Context tray model (docs/next 11 §E): the human curates what the agent gets. Pure selection →
// include-param mapping + the collapsed one-line summary; the tray component is thin glue.
import type { TaskContext, TaskContextInclude } from '../../../shared/api'

export type TraySelection = Record<TaskContextInclude, boolean>

// Notes now supersede the PR/issue auto-include: a PR-originated task's description, comments and
// linked-ticket bodies are seeded as curatable notes (docs/notes-and-memory.md), so PR/issues
// default off to avoid feeding the agent the same content twice. Both stay available to tick
// manually (they carry structural extras like the changed-file list). Memory stays opt-in.
export const DEFAULT_SELECTION: TraySelection = { pr: false, issues: false, notes: true, memory: false }

export function selectionToInclude(sel: TraySelection): TaskContextInclude[] {
  return (Object.keys(sel) as TaskContextInclude[]).filter((k) => sel[k])
}

// Collapsed summary: "3 sources · 2 notes · 4 memories". Sources = PR (if any) + linked issues.
export function traySummary(ctx: TaskContext | undefined): string {
  if (!ctx) return 'context'
  const sources = (ctx.pr ? 1 : 0) + ctx.issues.length
  const parts = [`${sources} source${sources === 1 ? '' : 's'}`]
  if (ctx.notes.length) parts.push(`${ctx.notes.length} note${ctx.notes.length === 1 ? '' : 's'}`)
  if (ctx.memory.length) parts.push(`${ctx.memory.length} memor${ctx.memory.length === 1 ? 'y' : 'ies'}`)
  return parts.join(' · ')
}
