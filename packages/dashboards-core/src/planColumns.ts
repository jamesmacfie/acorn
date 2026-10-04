import type { PanelPlan, PanelPlanColumn } from '@acorn/protocol/dashboards.ts'

/** The column a one-segment item pointer such as `/state` names, or undefined for any other pointer. */
export const pointerColumn = (pointer: string): string | undefined => /^\/[A-Za-z0-9_-]{1,100}$/.test(pointer) ? pointer.slice(1) : undefined

export function outputPlanColumns(plan: PanelPlan): PanelPlanColumn[] {
  let columns = [...plan.columns]
  for (const stage of plan.stages) {
    if (stage.op === 'compute') columns = [...columns, ...stage.columns.map(column => ({ id: column.id, label: column.label, type: column.type ?? 'number' as const, ...(column.unit ? { unit: column.unit } : {}), bind: {} }))]
    if (stage.op === 'summarize') {
      const pivot = stage.pivot ? columns.find(column => column.id === stage.pivot?.column) : undefined
      columns = [...stage.by.filter(by => by.column !== stage.pivot?.column).flatMap(by => columns.filter(column => column.id === by.column)),
      ...stage.measures.flatMap(measure => [{ id: measure.id, label: measure.label, type: ['distinct-list'].includes(measure.kind) ? 'text' as const : 'number' as const,
        ...(measure.kind === 'distinct-list' ? { list: true } : {}),
        ...(measure.share ? { unit: 'percent' } : measure.column ? { unit: columns.find(column => column.id === measure.column)?.unit } : {}), bind: {} },
        ...(measure.previous ? [{ id: `${measure.id}Previous`, label: `${measure.label} change`, type: 'number' as const,
          ...(measure.previous === 'ratio' ? { unit: 'percent' } : measure.column ? { unit: columns.find(column => column.id === measure.column)?.unit } : {}), bind: {} }] : [])])]
      if (stage.pivot) columns = [...columns, ...(pivot?.choices ?? []).map(choice => ({ id: `${stage.pivot!.measure}_${choice.id}`, label: choice.label, type: 'number' as const, bind: {} }))]
    }
    if (stage.op === 'expand') columns = [...columns, { id: stage.output, label: stage.output, type: columns.find(column => column.id === stage.column)?.type ?? 'text', bind: {} }]
    if (stage.op === 'overlap') columns = [...columns, ...columns.map(column => ({ ...column, id: `right_${column.id}`, label: `Other ${column.label}` })), { id: 'overlapDuration', label: 'Overlap duration', type: 'number', unit: 'ms', bind: {} }]
  }
  return columns
}
