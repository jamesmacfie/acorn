import type { TaskContext } from '../../../shared/api'

export type TraySelection = Record<string, boolean>

export const selectionFromContext = (ctx: TaskContext): TraySelection =>
  Object.fromEntries(ctx.sections.map((section) => [section.id, section.defaultIncluded]))

export function selectionToInclude(selection: TraySelection): string[] {
  return Object.entries(selection)
    .filter(([, included]) => included)
    .map(([id]) => id)
}

export function traySummary(ctx: TaskContext | undefined): string {
  if (!ctx) return 'context'
  const total = ctx.sections.reduce((sum, section) => sum + section.items.length, 0)
  const absent = ctx.sections.filter((section) => section.absent).length
  return `${ctx.sections.length} section${ctx.sections.length === 1 ? '' : 's'} · ${total} item${total === 1 ? '' : 's'}${absent ? ` · ${absent} incomplete` : ''}`
}
