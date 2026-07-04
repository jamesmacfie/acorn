// Context tray model (docs/next 11 §E): the human curates what the agent gets. Pure selection →
// include-param mapping + the collapsed one-line summary; the tray component is thin glue.
import type { TaskContext, TaskContextInclude } from '../../../shared/api'

export type TraySelection = Record<TaskContextInclude, boolean>

// Default to the always-safe slice checked (task + PR + linked issue titles + notes); memory is
// opt-in per the 11 §example.
export const DEFAULT_SELECTION: TraySelection = { pr: true, issues: true, notes: true, memory: false }

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
