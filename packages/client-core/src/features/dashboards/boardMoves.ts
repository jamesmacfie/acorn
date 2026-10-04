import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import type { DashboardRun } from '@acorn/dashboards-core/plan.ts'
import type { DataRecordRef } from '@acorn/protocol/dataSources.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'

export type BoardMove = { ref: DataRecordRef; field: string; expected: DataValue; target: DataValue;
  risk: 'read' | 'write' | 'execute'; sourceLabel: string; choiceId: string; columnId: string }
export type BoardMoveResult = { move: BoardMove; reason?: never } | { reason: string; move?: never }

/** Only a direct source row with one record has an unambiguous mutation target. */
export function boardMove(run: DashboardRun, row: DashboardDisplayRow, columnId: string, choiceId: string): BoardMoveResult {
  const column = run.plan.columns.find(item => item.id === columnId)
  const choice = column?.choices?.find(item => item.id === choiceId)
  if (!column || !choice) return { reason: 'This column has no writable choice.' }
  const sourceIds = Object.keys(row.sourceFieldValues ?? {})
  const sourceId = sourceIds[0]
  const source = run.diagnostics.sources.find(item => item.id === sourceId)
  const label = source?.label ?? row.pluginId
  if (row.summaryStage !== undefined || row.records?.length !== 1 || sourceIds.length !== 1) return { reason: `Cannot move ${label}: this row is not one direct source record.` }
  if (row.values[columnId] === choiceId) return { reason: `${label} is already in ${choice.label}.` }
  const binding = column.bind[sourceId!]
  if (!binding || !('field' in binding)) return { reason: `${label} has no source field bound to ${column.label}.` }
  if (!choice.writeValues || !Object.hasOwn(choice.writeValues, sourceId!)) return { reason: `No write value for ${label} here.` }
  const writable = source?.writable?.find(item => item.field === binding.field)
  if (!writable) return { reason: `${label} does not allow changes to ${column.label}.` }
  if (row.sourceWritableFields?.[sourceId!] && !row.sourceWritableFields[sourceId!]!.includes(binding.field)) return { reason: `${label} no longer allows this record to change.` }
  if (!Object.hasOwn(row.sourceFieldValues![sourceId!]!, binding.field)) return { reason: `${label} has no current value for ${column.label}.` }
  const target = choice.writeValues[sourceId!]!
  if (!writable.values.some(value => JSON.stringify(value) === JSON.stringify(target))) return { reason: `${label} no longer accepts this write value.` }
  return { move: { ref: row.records[0]!, field: binding.field, expected: row.sourceFieldValues![sourceId!]![binding.field]!,
    target, risk: writable.risk, sourceLabel: label, choiceId, columnId } }
}
