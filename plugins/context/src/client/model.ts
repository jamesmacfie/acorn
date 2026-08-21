import type { ContextBudget, TaskContext } from '@acorn/protocol/api.ts'
import { formatContextBlock } from '../contract/contextBlock'

export type TraySelection = Record<string, boolean>

export const selectionFromContext = (ctx: TaskContext): TraySelection =>
  Object.fromEntries(ctx.sections.map((section) => [section.id, section.defaultIncluded]))

export function traySummary(ctx: TaskContext | undefined): string {
  if (!ctx) return 'context'
  const total = ctx.sections.reduce((sum, section) => sum + section.items.length, 0)
  const absent = ctx.sections.filter((section) => section.absent).length
  return `${ctx.sections.length} section${ctx.sections.length === 1 ? '' : 's'} · ${total} item${total === 1 ? '' : 's'}${absent ? ` · ${absent} incomplete` : ''}`
}


// Worst-case byte allowance for a section's budget bar. Null when maxBytesPerItem is absent
// (memory's index-only budget); those sections show size text but no bar.
export function sectionCap(budget: ContextBudget): number | null {
  if (budget.maxBytesPerItem == null) return null
  return (budget.maxItems ?? 1) * budget.maxBytesPerItem
}

// Assemble the exact send block client-side from the include=* inventory (see the invariant comment
// in contextSections.ts): filter to selected sections, reuse the server's per-section `compact`.
// `sections` is the { id: compact } map used for staleness recording.
export function assembleBlockFrom(ctx: TaskContext, selection: TraySelection): { block: string; sections: Record<string, string> } {
  const picked = ctx.sections.filter((section) => selection[section.id])
  return {
    block: formatContextBlock({ ...ctx, sections: picked }),
    sections: Object.fromEntries(picked.map((section) => [section.id, section.compact])),
  }
}
