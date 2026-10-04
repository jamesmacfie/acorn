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
    if (stage.op === 'expand') {
      const list = columns.find(column => column.id === stage.column)
      columns = [...columns, { id: stage.output, label: list ? `${list.label} item` : stage.output, type: list?.type ?? 'text', bind: {} }]
    }
    if (stage.op === 'overlap') columns = [...columns, ...columns.map(column => ({ ...column, id: `right_${column.id}`, label: `Other ${column.label}` })), { id: 'overlapDuration', label: 'Overlap duration', type: 'number', unit: 'ms', bind: {} }]
  }
  return columns
}

/** Every column id a plan declares: bound, attached by a relation, calculated, measured, or expanded. */
export function planColumnIds(plan: PanelPlan): Set<string> {
  return new Set([
    ...plan.columns.map(column => column.id),
    ...(plan.relations ?? []).flatMap(relation => relation.output ? [relation.output] : []),
    ...plan.stages.flatMap(stage => stage.op === 'compute' ? stage.columns.map(column => column.id)
      : stage.op === 'summarize' ? stage.measures.flatMap(measure => [measure.id, `${measure.id}Previous`])
        : stage.op === 'expand' ? [stage.output] : stage.op === 'overlap' ? ['overlapDuration'] : []),
  ])
}

/** A new column's id, made from its label: lower camel case, unique within the plan, and at most 100
 *  characters. It's made once, when the column is created. Renaming the label later keeps the id,
 *  because later steps refer to the column by it. */
export function newColumnId(plan: PanelPlan, label: string): string {
  const words = label.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  const base = (words.map((word, index) => index ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()).join('') || 'column').slice(0, 100)
  const taken = planColumnIds(plan)
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base.slice(0, 100 - String(suffix).length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}
