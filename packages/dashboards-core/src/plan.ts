import { compareDataValues, type DataBinding, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { DashboardPanelContent, PanelPlan, PanelPlanColumn } from '@acorn/protocol/dashboards.ts'
import type { DataRecord, DataSourceDescription, DataSourceQuery, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { PANEL_CAPABILITIES } from './capabilities'
import type { DashboardDisplayField, DashboardDisplayRow, DashboardDisplaySchema } from './display'
import { dashboardFields } from './typedProjection'

export type PlanProblem = { path: string; message: string; severity: 'error' | 'warning' }
export type PlanSource = { instanceId: string; label: string; query: DataSourceQuery; description: DataSourceDescription; result?: DataSourceResult }
export type PlanRow = { id: string; values: Record<string, DataValue>; records: DataRecord['ref'][]; taskId?: string; action?: DataRecord['action'] }
export type PlanGroup = { key: string; label: string; count: number; rows: PlanRow[]; children?: PlanGroup[] }
export type PlanStageCount = { path: string; input: number; output: number }
export type DashboardRun = {
  plan: PanelPlan
  rows: PlanRow[]
  groups: PlanGroup[]
  diagnostics: {
    problems: PlanProblem[]
    sources: { id: string; label: string; revision?: string; queryDigest?: string; parameters?: Record<string, DataValue>; account?: string | null; completeness?: DataSourceResult['completeness']; readTime?: number }[]
    stages: PlanStageCount[]
    evaluationTime: number
    plugins: string[]
    accounts: string[]
    complete: boolean
  }
  description: string[]
}

const pathPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')
const columnAt = (plan: PanelPlan, id: string): PanelPlanColumn | undefined => plan.columns.find(column => column.id === id)
const pointerColumn = (pointer: string): string | undefined => /^\/[A-Za-z0-9_-]{1,100}$/.test(pointer) ? pointer.slice(1) : undefined
const bindingColumns = (binding: DataBinding): string[] => binding.address.from === 'item'
  ? [pointerColumn(binding.address.pointer) ?? ''] : []
const fixesUnit = (predicate: DataPredicate, unit: string): boolean => predicate.kind === 'comparison'
  ? predicate.operator === 'eq' && predicate.left.address.from === 'item' && predicate.left.address.pointer === `/${unit}` && predicate.right?.address.from === 'literal'
  : predicate.kind === 'all' && predicate.predicates.some(part => fixesUnit(part, unit))

function predicateColumns(predicate: DataPredicate): string[] {
  return predicate.kind === 'comparison'
    ? [...bindingColumns(predicate.left), ...(predicate.right ? bindingColumns(predicate.right) : [])]
    : predicate.predicates.flatMap(predicateColumns)
}

function readBinding(row: PlanRow, binding: DataBinding): DataValue | typeof MISSING {
  const address = binding.address
  if (address.from === 'literal') return address.value
  if (address.from !== 'item') return MISSING
  return readDataPointer(row.values, address.pointer)
}

export function matchesPlanFilter(row: PlanRow, predicate: DataPredicate): boolean {
  if (predicate.kind !== 'comparison') return predicate.kind === 'all'
    ? predicate.predicates.every(part => matchesPlanFilter(row, part))
    : predicate.predicates.some(part => matchesPlanFilter(row, part))
  const left = readBinding(row, predicate.left)
  const right = predicate.right ? readBinding(row, predicate.right) : MISSING
  try { return compareDataValues(left, predicate.operator, right) }
  catch { return false }
}

function fieldType(source: PlanSource, fieldPointer: string): PanelPlanColumn['type'] | undefined {
  const field = source.description.fields.find(candidate => candidate.pointer === fieldPointer)
  if (!field) return undefined
  if (field.display?.kind) return field.display.kind === 'status' ? 'enum' : field.display.kind
  const pointer = fieldPointer.slice(1).split('/')
  let schema = source.description.schema
  for (const part of pointer) {
    const next = schema.properties?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]
    if (!next) return undefined
    schema = next
  }
  return schema.type === 'number' || schema.type === 'integer' ? 'number'
    : schema.type === 'boolean' ? 'boolean' : 'text'
}

/** Structural and currently described-source checks. Never silently drops a broken binding. */
export function validatePanelPlan(plan: PanelPlan, sources: readonly PlanSource[]): PlanProblem[] {
  const problems: PlanProblem[] = []
  const add = (path: string, message: string, severity: PlanProblem['severity'] = 'error') => problems.push({ path, message, severity })
  try { new Intl.DateTimeFormat('en', { timeZone: plan.time.zone }) }
  catch { add('/time/zone', `"${plan.time.zone}" is not an IANA time zone.`) }
  if (new Set(plan.sources.map(source => source.id)).size !== plan.sources.length) add('/sources', 'Source IDs must be unique.')
  if (new Set(plan.columns.map(column => column.id)).size !== plan.columns.length) add('/columns', 'Column IDs must be unique.')
  for (const [index, source] of plan.sources.entries()) {
    if (!sources.some(candidate => candidate.instanceId === source.id)) add(`/sources/${index}`, `${source.label} is unavailable.`)
  }
  for (const [index, column] of plan.columns.entries()) {
    if (column.precision && column.type !== 'datetime') add(`/columns/${index}/precision`, 'Only a date column has precision.')
    if (column.choices && column.type !== 'enum') add(`/columns/${index}/choices`, 'Only an enum column has choices.')
    if (typeof column.unit === 'object' && !columnAt(plan, column.unit.column)) add(`/columns/${index}/unit`, `Unit column ${column.unit.column} is missing.`)
    for (const [sourceId, binding] of Object.entries(column.bind)) {
      const path = `/columns/${index}/bind/${pathPart(sourceId)}`
      if (!plan.sources.some(source => source.id === sourceId)) { add(path, `Source ${sourceId} is not in this plan.`); continue }
      const source = sources.find(candidate => candidate.instanceId === sourceId)
      if (!source || !('field' in binding)) continue
      const actual = fieldType(source, binding.field)
      if (!actual) add(path, `${column.label} uses ${binding.field}, which ${source.label} no longer describes. Rebind this column.`)
      else if (column.type && actual !== column.type) add(path, `${column.label} expects ${column.type}, but ${source.label} now describes ${binding.field} as ${actual}. Rebind this column.`)
      if (binding.values) {
        const field = source.description.fields.find(candidate => candidate.pointer === binding.field)
        const known = new Set(field?.choices?.kind === 'static' ? field.choices.values.map(choice => choice.id) : [])
        for (const value of Object.values(binding.values).flat()) if (known.size && !known.has(value)) add(path, `${column.label} maps a value ${source.label} no longer declares: ${value}.`, 'warning')
      }
    }
  }
  for (const [index, stage] of plan.stages.entries()) {
    if (!PANEL_CAPABILITIES.operations.some(operation => operation.id === stage.op)) add(`/stages/${index}/op`, `Operation ${stage.op} is unavailable.`)
    for (const id of predicateColumns(stage.where)) {
      if (!id || !columnAt(plan, id)) add(`/stages/${index}/where`, `Filter names an unavailable column: ${id || '(invalid pointer)'}.`)
    }
    const check = (predicate: DataPredicate): void => {
      if (predicate.kind !== 'comparison') { predicate.predicates.forEach(check); return }
      const id = predicate.left.address.from === 'item' ? pointerColumn(predicate.left.address.pointer) : undefined
      const column = id ? columnAt(plan, id) : undefined
      if (!column) return
      const right = predicate.right?.address
      if (['lt', 'lte', 'gt', 'gte'].includes(predicate.operator) && !['number', 'datetime', 'text'].includes(column.type ?? 'text')) add(`/stages/${index}/where`, `${column.label} cannot be ordered.`)
      if (predicate.operator === 'contains' && !column.list && column.type !== 'text') add(`/stages/${index}/where`, `${column.label} cannot use contains.`)
      if (right?.from === 'literal' && right.value != null) {
        if (column.type === 'number' && typeof right.value !== 'number' && predicate.operator !== 'in') add(`/stages/${index}/where`, `${column.label} needs a number comparison value.`)
        if (column.type === 'boolean' && typeof right.value !== 'boolean' && predicate.operator !== 'in') add(`/stages/${index}/where`, `${column.label} needs a true or false comparison value.`)
      }
      if (column.type === 'number' && typeof column.unit === 'object' && !['missing', 'present'].includes(predicate.operator)
        && !plan.stages.slice(0, index).some(previous => fixesUnit(previous.where, (column.unit as { column: string }).column))) add(`/stages/${index}/where`, `${column.label} has per-row units; compare only after fixing one unit.`)
    }
    check(stage.where)
  }
  for (const [index, sort] of (plan.sort ?? []).entries()) {
    const column = columnAt(plan, sort.column)
    if (!column) add(`/sort/${index}/column`, `Sort column ${sort.column} is unavailable.`)
    else if (typeof column.unit === 'object' && !plan.group?.some(group => group.column === (column.unit as { column: string }).column)) add(`/sort/${index}/column`, `${column.label} has mixed units; group by its unit first.`)
  }
  for (const [index, group] of (plan.group ?? []).entries()) {
    const column = columnAt(plan, group.column)
    if (!column) add(`/group/${index}/column`, `Group column ${group.column} is unavailable.`)
    else if (group.bucket && group.bucket !== 'value' && column.type !== 'datetime') add(`/group/${index}/bucket`, 'Time buckets require a date column.')
    if (group.order === 'explicit' && !group.values?.length) add(`/group/${index}/values`, 'An explicit order needs values.')
  }
  if (plan.view.kind === 'board' && (plan.group?.length !== 1 || columnAt(plan, plan.group[0]!.column)?.type !== 'enum')) add('/view/kind', 'A board needs one enum group.')
  for (const key of ['field', 'x', 'series'] as const) {
    const ref = plan.view[key]
    if (ref !== undefined && !columnAt(plan, ref)) add(`/view/${key}`, `View column ${ref} is unavailable.`)
  }
  if (plan.view.aggregate && plan.view.aggregate !== 'count' && columnAt(plan, plan.view.field ?? '')?.type !== 'number') add('/view/field', 'This aggregate needs a number column.')
  const measured = columnAt(plan, plan.view.field ?? '')
  if (plan.view.aggregate && plan.view.aggregate !== 'count' && typeof measured?.unit === 'object'
    && !plan.stages.some(stage => fixesUnit(stage.where, (measured.unit as { column: string }).column))) add('/view/field', 'An aggregate needs one fixed unit; filter by currency first.')
  if (plan.view.kind === 'chart' && !['datetime', 'enum'].includes(columnAt(plan, plan.view.x ?? '')?.type ?? '')) add('/view/x', 'A chart needs a date or enum axis.')
  if (plan.view.shape === 'line' && columnAt(plan, plan.view.x ?? '')?.type !== 'datetime') add('/view/x', 'A line chart needs a date axis.')
  if (plan.view.shape === 'bar' && columnAt(plan, plan.view.x ?? '')?.type !== 'enum') add('/view/x', 'A bar chart needs an enum axis.')
  if (plan.view.series && columnAt(plan, plan.view.series)?.type !== 'enum') add('/view/series', 'A series needs an enum column.')
  if (plan.view.trend && plan.view.kind !== 'stat') add('/view/trend', 'A trend belongs on a stat view.')
  if (plan.view.compare && !plan.view.trend) add('/view/compare', 'A comparison needs a trend.')
  for (const [index, requirement] of (plan.requirements ?? []).entries()) {
    if (['covered', 'partial'].includes(requirement.status)) for (const path of requirement.paths ?? []) {
      if (!/^\/(sources|columns|stages|sort|group|view)(\/|$)/.test(path)) add(`/requirements/${index}/paths`, `${path} is not a plan part.`)
    }
    if (requirement.status !== 'covered' && !requirement.reason) add(`/requirements/${index}/reason`, `${requirement.text} needs a reason.`)
  }
  for (const [index, source] of sources.entries()) if (source.query.take && plan.stages.length) add(`/sources/${index}/reference`, 'The source limits its rows before the panel filter runs.', 'warning')
  return problems
}

function mappedValue(column: PanelPlanColumn, source: PlanSource, record: DataRecord): DataValue {
  const binding = column.bind[source.instanceId]
  if (!binding) return null
  if ('value' in binding) return binding.value
  const raw = readDataPointer(record.data, binding.field)
  if (raw === MISSING) return null
  if (binding.values && typeof raw === 'string') {
    const mapped = Object.entries(binding.values).find(([, values]) => values.includes(raw))?.[0]
    return mapped ?? (column.unmatched === 'hidden' ? null : raw)
  }
  if (typeof raw === 'number' && column.unit === 'ms') {
    const sourceUnit = dashboardFields(source.description).find(field => field.id === binding.field)?.unit
    if (sourceUnit === 's') return raw * 1000
  }
  return raw
}

export function bindPanelRows(plan: PanelPlan, sources: readonly PlanSource[]): PlanRow[] {
  return sources.flatMap(source => (source.result?.records ?? []).map(record => ({
    id: `${source.instanceId}:${record.ref.recordId}`,
    values: Object.fromEntries(plan.columns.map(column => [column.id, mappedValue(column, source, record)])),
    records: [record.ref],
    ...(record.taskId ? { taskId: record.taskId } : {}),
    ...(record.action ? { action: record.action } : {}),
  })))
}

export function resolvePlanColumns(plan: PanelPlan, sources: readonly PlanSource[]): PanelPlan {
  // Version 1 panels without a display field selection meant "all source fields".
  // Resolve that legacy meaning against the current description at run time.
  const columns: PanelPlanColumn[] = plan.columns.length || sources.length !== 1 ? plan.columns
    : dashboardFields(sources[0]!.description).slice(0, 100).map(field => ({
      id: field.id.slice(1).replace(/[^A-Za-z0-9_-]/g, '_'), label: field.name,
      type: field.type, bind: { [sources[0]!.instanceId]: { field: field.id } },
    }))
  return { ...plan, columns: columns.map(column => {
    const field = sources.flatMap(source => {
      const binding = column.bind[source.instanceId]
      return binding && 'field' in binding ? dashboardFields(source.description).filter(candidate => candidate.id === binding.field) : []
    })[0]
    if (!field) return column
    return {
      ...column,
      type: column.type ?? field.type,
      ...(column.unit ? {} : field.unit ? { unit: field.unit } : {}),
      ...(column.choices ? {} : field.values ? { choices: field.values.map(choice => ({ ...choice })) } : {}),
    }
  }) }
}

const stageRunners: Record<PanelPlan['stages'][number]['op'], (rows: PlanRow[], stage: PanelPlan['stages'][number]) => PlanRow[]> = {
  filter: (rows, stage) => rows.filter(row => matchesPlanFilter(row, stage.where)),
}

export function runPlanStages(plan: PanelPlan, rows: readonly PlanRow[]): { rows: PlanRow[]; counts: PlanStageCount[] } {
  let current = [...rows]
  const counts: PlanStageCount[] = []
  for (const [index, stage] of plan.stages.entries()) {
    const input = current.length
    current = stageRunners[stage.op](current, stage)
    counts.push({ path: `/stages/${index}`, input, output: current.length })
  }
  return { rows: current, counts }
}

function compareCells(left: DataValue | undefined, right: DataValue | undefined): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

export function sortPlanRows(plan: PanelPlan, rows: readonly PlanRow[]): PlanRow[] {
  const sorted = [...rows]
  sorted.sort((left, right) => {
    for (const key of plan.sort ?? []) {
      const a = left.values[key.column], b = right.values[key.column]
      const absentA = a == null, absentB = b == null
      if (absentA || absentB) {
        if (absentA === absentB) continue
        return (absentA ? 1 : -1) * (key.empty === 'first' ? -1 : 1)
      }
      const column = columnAt(plan, key.column)
      const rank = (value: DataValue): number => {
        const index = column?.choices?.findIndex(choice => choice.id === value) ?? -1
        return index < 0 ? (column?.choices?.length ?? 0) : (column?.choices?.[index]?.rank ?? index)
      }
      const ranked = column?.type === 'enum' ? rank(a) - rank(b) : 0
      const order = ranked || compareCells(a, b)
      if (order) return key.direction === 'desc' ? -order : order
    }
    return 0
  })
  return sorted
}

function datePart(value: DataValue, zone: string): { day: string; month: string } | undefined {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { day: value, month: value.slice(0, 7) }
  const instant = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(instant)) return undefined
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant)
  const get = (kind: string) => parts.find(part => part.type === kind)?.value ?? ''
  return { day: `${get('year')}-${get('month')}-${get('day')}`, month: `${get('year')}-${get('month')}` }
}

export function groupPlanRows(plan: PanelPlan, rows: readonly PlanRow[], evaluationTime: number): PlanGroup[] {
  const zone = plan.time.zone
  const today = datePart(evaluationTime, zone)?.day ?? ''
  const keys = plan.group ?? []
  const group = (items: readonly PlanRow[], depth: number): PlanGroup[] => {
    const spec = keys[depth]
    if (!spec) return []
    const buckets = new Map<string, PlanRow[]>()
    for (const row of items) {
      const value = row.values[spec.column]
      const date = spec.bucket && spec.bucket !== 'value' ? datePart(value, zone) : undefined
      let key = value == null ? 'No value' : String(value)
      if (spec.bucket === 'day') key = date?.day ?? 'No date'
      if (spec.bucket === 'month') key = date?.month ?? 'No date'
      if (spec.bucket === 'week' && date) {
        const day = new Date(`${date.day}T12:00:00Z`)
        const start = { sunday: 0, monday: 1, saturday: 6 }[plan.time.weekStart]
        day.setUTCDate(day.getUTCDate() - (day.getUTCDay() - start + 7) % 7)
        key = day.toISOString().slice(0, 10)
      }
      if (spec.bucket === 'relative') key = !date ? 'No date' : date.day < today ? 'Overdue' : date.day === today ? 'Today' : date.day <= new Date(Date.parse(`${today}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10) ? 'Next seven days' : 'Later'
      buckets.set(key, [...(buckets.get(key) ?? []), row])
    }
    const declared = columnAt(plan, spec.column)?.choices?.map(choice => choice.id) ?? []
    const ordered = [...buckets].sort(([a, ar], [b, br]) => spec.order === 'count' ? br.length - ar.length
      : spec.order === 'declared' || spec.order === 'explicit' ? (() => {
        const order = spec.order === 'explicit' ? spec.values ?? [] : declared
        const ai = order.indexOf(a), bi = order.indexOf(b)
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || a.localeCompare(b)
      })() : a.localeCompare(b))
    return ordered.map(([key, members]) => ({ key, label: key, count: members.length, rows: members, ...(depth + 1 < keys.length ? { children: group(members, depth + 1) } : {}) }))
  }
  return group(rows, 0)
}

export function describePanelPlan(plan: PanelPlan, sources: readonly PlanSource[] = []): string[] {
  const labels = plan.sources.map(source => {
    const resolved = sources.find(candidate => candidate.instanceId === source.id)
    const scope = resolved?.query.scope
    return `${source.label}${scope?.connectionId ? ` through account ${scope.connectionId}` : ''}`
  })
  const describePredicate = (predicate: DataPredicate): string => {
    if (predicate.kind !== 'comparison') return predicate.predicates.map(describePredicate).join(predicate.kind === 'all' ? ' and ' : ' or ')
    const address = predicate.left.address
    const id = address.from === 'item' ? pointerColumn(address.pointer) : undefined
    const name = columnAt(plan, id ?? '')?.label ?? id ?? 'a value'
    const right = predicate.right?.address
    const value = right?.from === 'literal' ? JSON.stringify(right.value) : 'another value'
    return predicate.operator === 'missing' ? `${name} is missing`
      : predicate.operator === 'present' ? `${name} is present`
        : `${name} ${predicate.operator} ${value}`
  }
  return [
    `One row per record from ${labels.join(' and ')}.`,
    ...sources.map(source => `${source.label} reaches ${source.description.consistency}; scope ${JSON.stringify(source.query.scope.parameters)}.`),
    `Columns: ${plan.columns.map(column => column.label).join(', ') || 'none'}.`,
    ...plan.stages.map(stage => `Keep rows where ${describePredicate(stage.where)}.`),
    ...(sources.some(source => source.query.take && plan.stages.length) ? ['A source limit applies before the panel filter.'] : []),
    ...(plan.sort?.length ? [`Sort by ${plan.sort.map(item => `${columnAt(plan, item.column)?.label ?? item.column} ${item.direction === 'desc' ? 'newest or highest first' : 'oldest or lowest first'}`).join(', ')}.`] : []),
    ...(plan.group?.length ? [`Group by ${plan.group.map(item => columnAt(plan, item.column)?.label ?? item.column).join(' then ')}.`] : []),
    ...(plan.limit ? [`Show at most ${plan.limit} rows after filtering and sorting.`] : []),
  ]
}

/** A renderer adapter over the Node's plan rows. The Node remains the only executor. */
export function displayPlanRun(plan: PanelPlan, rows: readonly PlanRow[]): { schema: DashboardDisplaySchema; fields: DashboardDisplayField[]; rows: DashboardDisplayRow[] } {
  const fields: DashboardDisplayField[] = plan.columns.map(column => ({
    id: column.id, name: column.label, type: column.type ?? 'text',
    ...(column.id === 'title' || column.id === 'status' || column.id === 'updated' || column.id === 'url'
      ? { role: column.id } : {}),
    ...(column.precision ? { precision: column.precision } : {}),
    ...(column.type === 'datetime' ? { zone: plan.time.mode === 'viewer' ? Intl.DateTimeFormat().resolvedOptions().timeZone : plan.time.zone } : {}),
    ...(column.list ? { list: true } : {}),
    ...(typeof column.unit === 'string' ? { unit: column.unit } : {}),
    ...(column.choices ? { values: column.choices.map(choice => ({ ...choice })) } : {}),
  }))
  const schema = { fields }
  return {
    schema, fields,
    rows: rows.map(row => ({
      id: row.id,
      values: Object.fromEntries(fields.map(field => {
        const value = row.values[field.id]
        return [field.id, value === null || value === undefined ? null : Array.isArray(value)
          ? value.map(item => item === null ? null : typeof item === 'object' ? JSON.stringify(item) : item)
          : typeof value === 'object' ? JSON.stringify(value) : value]
      })),
      units: Object.fromEntries(plan.columns.flatMap(column => {
        if (typeof column.unit !== 'object') return []
        const unit = row.values[column.unit.column]
        return typeof unit === 'string' ? [[column.id, unit]] : []
      })),
      pluginId: row.records[0]?.pluginId ?? 'core',
      sourceId: row.records[0]?.sourceId ?? '',
      sourceRowId: row.records[0]?.recordId,
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.action ? { action: row.action } : {}),
    })),
  }
}

export type DisplayPlanGroup = { key: string; label: string; count: number; rows: DashboardDisplayRow[]; children?: DisplayPlanGroup[] }
export function displayPlanGroups(groups: readonly PlanGroup[], rows: readonly DashboardDisplayRow[]): DisplayPlanGroup[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  return groups.map(group => ({
    key: group.key, label: group.label, count: group.count,
    rows: group.rows.flatMap(row => byId.has(row.id) ? [byId.get(row.id)!] : []),
    ...(group.children ? { children: displayPlanGroups(group.children, rows) } : {}),
  }))
}

/** A read-only projection of a version 1 revision. Callers must keep its original bytes and digest. */
export function upgradePanelContent(content: DashboardPanelContent): PanelPlan {
  const mapped = content.queries.length > 1 || content.mapping.columns.length > 0
    || Object.values(content.mapping.fields).some(fields => Object.keys(fields).length > 0)
  const roles = ['title', 'status', 'assignee', 'updated', 'url'] as const
  const columns: PanelPlanColumn[] = mapped
    ? roles.flatMap(role => content.queries.some(query => content.mapping.fields[query.id]?.[role]) ? [{
      id: role,
      label: role[0]!.toUpperCase() + role.slice(1),
      bind: Object.fromEntries(content.queries.flatMap(query => {
        const field = content.mapping.fields[query.id]?.[role]
        return field ? [[query.id, { field, ...(role === 'status' && content.mapping.values[query.id] ? { values: content.mapping.values[query.id] } : {}) }]] : []
      })),
      ...(role === 'status' && content.mapping.columns.length ? {
        type: 'enum' as const,
        choices: content.mapping.columns.map(choice => ({ id: choice.id, label: choice.label, ...(choice.tone ? { tone: choice.tone } : {}) })),
        unmatched: content.mapping.unmapped,
      } : {}),
    }] : [])
    : [...new Set(content.display.fields)].filter(field => /^\/[A-Za-z0-9_-]+$/.test(field)).map(field => ({
      id: field.slice(1), label: field.slice(1), bind: { [content.queries[0]!.id]: { field } },
    }))
  if (mapped) columns.push({
    id: 'source', label: 'Source', type: 'text',
    bind: Object.fromEntries(content.queries.map(query => [query.id, { value: query.label }])),
  })
  const toId = (reference: string | undefined): string | undefined => {
    if (!reference) return undefined
    const found = columns.find(column => column.id === reference || reference === `/${column.id}`)
    return found?.id
  }
  const { field: _field, x: _x, series: _series, ...view } = content.display.view
  return {
    version: 2,
    title: content.title,
    time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
    sources: content.queries.map(query => ({ ...query, role: 'primary' })),
    columns,
    stages: [],
    ...(toId(content.display.groupBy) ? { group: [{ column: toId(content.display.groupBy)!, bucket: 'value' }] } : {}),
    ...(content.display.limit ? { limit: content.display.limit } : {}),
    view: {
      ...view,
      ...(toId(content.display.view.field) ? { field: toId(content.display.view.field) } : {}),
      ...(toId(content.display.view.x) ? { x: toId(content.display.view.x) } : {}),
      ...(toId(content.display.view.series) ? { series: toId(content.display.view.series) } : {}),
    },
  }
}
