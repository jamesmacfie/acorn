import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { PlanSource } from '@acorn/dashboards-core/plan.ts'

function bounds(predicate: DataPredicate, pointers: Set<string>, operators: readonly string[]): number[] {
  if (predicate.kind === 'any') return []
  if (predicate.kind === 'all') return predicate.predicates.flatMap(part => bounds(part, pointers, operators))
  if (predicate.kind !== 'comparison') return []
  if (predicate.left.address.from !== 'item' || !pointers.has(predicate.left.address.pointer)
    || !operators.includes(predicate.operator) || predicate.right?.address.from !== 'literal'
    || typeof predicate.right.address.value !== 'number') return []
  return [predicate.right.address.value]
}

/** A lower time bound can prove an event read missed part of the requested window. */
export function sourceCoverageProblem(plan: PanelPlan, source: PlanSource, evaluationTime = source.result?.readTime ?? Date.now()): string | undefined {
  if (source.description.coverage?.kind !== 'events' || !source.result) return undefined
  const timeColumns = new Set(plan.columns.filter(column => column.type === 'datetime'
    && column.bind[source.instanceId] && 'field' in column.bind[source.instanceId]!).map(column => `/${column.id}`))
  const sourceTimes = new Set(source.description.fields.filter(field => field.display?.kind === 'datetime').map(field => field.pointer))
  const filters = plan.stages.filter(stage => stage.op === 'filter')
  const lower = filters.flatMap(stage => bounds(stage.where, timeColumns, ['gt', 'gte']))
  const upper = filters.flatMap(stage => bounds(stage.where, timeColumns, ['lt', 'lte']))
  if (source.query.predicate) {
    lower.push(...bounds(source.query.predicate, sourceTimes, ['gt', 'gte']))
    upper.push(...bounds(source.query.predicate, sourceTimes, ['lt', 'lte']))
  }
  if (!lower.length && !upper.length) return undefined
  const requested = lower.length ? Math.max(...lower) : -Infinity
  const requestedEnd = upper.length ? Math.min(...upper) : evaluationTime
  const earliest = Math.max(source.description.coverage.earliestTime ?? -Infinity, source.result.coveredRange?.start ?? -Infinity)
  if (!lower.length && Number.isFinite(earliest)) return `${source.label} has no verified coverage before ${new Date(earliest).toISOString()}; an empty result cannot establish absence.`
  if (earliest > requested) return `${source.label} has no verified coverage from ${new Date(requested).toISOString()} to ${new Date(earliest).toISOString()}; an empty result cannot establish absence.`
  if (source.result.coveredRange && source.result.coveredRange.end < requestedEnd) return `${source.label} has no verified coverage after ${new Date(source.result.coveredRange.end).toISOString()}; an empty result cannot establish absence.`
  if (!source.description.coverage.complete) return `${source.label} does not guarantee complete event coverage for this window.`
  return undefined
}
