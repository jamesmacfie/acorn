import { compareDataValues, type DataBinding, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { MISSING, canonicalDataEncoding, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { PanelPlan, PanelPlanColumn } from '@acorn/protocol/dashboards.ts'
import type { DataRecord, DataSourceDescription, DataSourceQuery, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { PANEL_CAPABILITIES } from './capabilities'
import { outputPlanColumns } from './planColumns'
import { evaluateExpression, expandRows, overlapRows, summarizeRows } from './analysis'
import { relatePanelRows } from './relations'
import type { DashboardDisplayField, DashboardDisplayRow, DashboardDisplaySchema } from './display'
import { dashboardFields } from './typedProjection'
import { bucketBounds } from './planBuckets'

export { PANEL_CAPABILITIES } from './capabilities'

export type PlanProblem = { path: string; message: string; severity: 'error' | 'warning' }
export type PlanSource = { instanceId: string; label: string; query: DataSourceQuery; description: DataSourceDescription; accountLabel?: string; result?: DataSourceResult }
export type PlanRecordItem = Pick<DataRecord, 'ref' | 'taskId' | 'action' | 'actions' | 'target'>
export type PlanRow = { id: string; values: Record<string, DataValue>; records: DataRecord['ref'][]; recordItems?: PlanRecordItem[]; taskId?: string; action?: DataRecord['action']; actions?: DataRecord['actions']; target?: DataRecord['target']; representedRows?: PlanRow[]; measureRows?: Record<string, PlanRow[]>; partial?: Record<string, string>; childRecords?: Record<string, DataRecord[]>; summaryStage?: number; datasetGroups?: Record<string, { groupValues: Record<string, DataValue>; measureId: string }>; correctableDatasetId?: string; sourceRecords?: Record<string, DataRecord['ref']>; sourceValues?: Record<string, Record<string, DataValue>>; sourceFieldValues?: Record<string, Record<string, DataValue>>; sourceWritableFields?: Record<string, string[]> }
export type PlanGroup = { key: string; label: string; count: number; rows: PlanRow[]; children?: PlanGroup[] }
export type PlanStageCount = { path: string; input: number; output: number; meaning?: string }
export type DashboardRun = {
  plan: PanelPlan
  rows: PlanRow[]
  groups: PlanGroup[]
  diagnostics: {
    problems: PlanProblem[]
    sources: { id: string; label: string; revision?: string; queryDigest?: string; parameters?: Record<string, DataValue>; account?: string | null;
      completeness?: DataSourceResult['completeness']; readTime?: number; coverageWindows?: DataSourceDescription['coverageWindows'];
      coveredRange?: DataSourceResult['coveredRange']; observedAt?: number; writable?: DataSourceDescription['writable'] }[]
    stages: PlanStageCount[]
    evaluationTime: number
    asOf?: number
    plugins: string[]
    accounts: string[]
    complete: boolean
  }
  description: string[]
}

const pathPart = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')
const columnAt = (plan: PanelPlan, id: string): PanelPlanColumn | undefined => plan.columns.find(column => column.id === id)
export { outputPlanColumns } from './planColumns'
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
  if (!plan.sources.some(source => source.role === 'primary')) add('/sources', 'Choose at least one primary source to supply rows.')
  if (new Set(plan.columns.map(column => column.id)).size !== plan.columns.length) add('/columns', 'Column IDs must be unique.')
  for (const [index, source] of plan.sources.entries()) {
    if (!sources.some(candidate => candidate.instanceId === source.id)) add(`/sources/${index}`, `${source.label} is unavailable.`)
  }
  for (const [index, column] of plan.columns.entries()) {
    if (column.precision && column.type !== 'datetime') add(`/columns/${index}/precision`, 'Only a date column has precision.')
    if (column.choices && column.type !== 'enum') add(`/columns/${index}/choices`, 'Only an enum column has choices.')
    for (const [choiceIndex, choice] of (column.choices ?? []).entries()) for (const [sourceId, value] of Object.entries(choice.writeValues ?? {})) {
      const path = `/columns/${index}/choices/${choiceIndex}/writeValues/${pathPart(sourceId)}`
      const source = sources.find(candidate => candidate.instanceId === sourceId)
      const binding = column.bind[sourceId]
      if (!source || !binding || !('field' in binding)) { add(path, 'Choose a bound source field for this write value.'); continue }
      const writable = source.description.writable?.find(field => field.field === binding.field)
      if (!writable) add(path, `${source.label} does not declare ${binding.field} writable.`)
      else if (!writable.values.some(allowed => canonicalDataEncoding(allowed) === canonicalDataEncoding(value))) add(path, `${source.label} no longer accepts this write value.`)
    }
    for (const sourceId of column.precedence ?? []) if (!plan.sources.some(source => source.id === sourceId)) add(`/columns/${index}/precedence`, `Source ${sourceId} is not in this plan.`)
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
  let available = new Set(plan.columns.map(column => column.id))
  let summarized = 0, overlapped = 0
  if (plan.stages.length > 8) add('/stages', 'A panel can have at most eight stages.')
  for (const [index, relation] of (plan.relations ?? []).entries()) {
    const from = plan.sources.find(source => source.id === relation.from)
    const to = plan.sources.find(source => source.id === relation.to)
    if (!from || !to) add(`/relations/${index}`, 'Both sources must exist.')
    else if (relation.kind === 'equivalence' && (from.role !== 'primary' || to.role !== 'primary')) add(`/relations/${index}/kind`, 'Equivalence joins two primary sources.')
    else if (relation.kind !== 'equivalence' && (from.role !== 'primary' || to.role === 'primary')) add(`/relations/${index}`, 'Lookup or children relation starts at a primary source.')
    if (relation.kind !== 'equivalence' && relation.cardinality === 'one-to-many' && to?.role !== 'children') add(`/relations/${index}/cardinality`, 'A one-to-many relation needs a children source.')
    if (relation.kind === 'equivalence' && relation.cardinality !== 'one-to-one') add(`/relations/${index}/cardinality`, 'Equivalence must match one item on each side.')
    if (relation.kind !== 'equivalence' && relation.cardinality !== 'one-to-many' && to?.role !== 'lookup') add(`/relations/${index}/cardinality`, 'A lookup needs one-to-one or many-to-one cardinality.')
    const scopes = new Set(relation.keys.map(part => part.scope))
    for (const scope of ['provider', 'account', 'identity'] as const) if (!scopes.has(scope)) add(`/relations/${index}/keys`, `Relation key must include ${scope} scope.`)
    const declared = sources.find(source => source.instanceId === relation.from)?.description.relations?.find(item => item.id === relation.id)
    if (declared) for (const scope of declared.requiredScopes) if (!scopes.has(scope)) add(`/relations/${index}/keys`, `Declared relation needs ${scope} scope.`)
    if (declared && (declared.target.pluginId !== sources.find(source => source.instanceId === relation.to)?.query.source.pluginId
      || declared.target.sourceId !== sources.find(source => source.instanceId === relation.to)?.query.source.sourceId
      || declared.kind !== relation.kind || declared.cardinality !== relation.cardinality)) add(`/relations/${index}`, 'Relation does not match the source declaration.')
    if (declared && (declared.keys.length !== relation.keys.length || declared.keys.some((part, at) => {
      const selected = relation.keys[at]
      return !selected || part.from !== selected.from || part.to !== selected.to || part.scope !== selected.scope
    }))) add(`/relations/${index}/keys`, 'Use the exact keys declared by the source.')
    if (!declared && relation.kind !== 'equivalence') add(`/relations/${index}`, 'This relation is not declared by its source.')
    for (const [at, key] of relation.keys.entries()) {
      if (from && !sources.find(source => source.instanceId === from.id)?.description.fields.some(field => field.pointer === key.from)) add(`/relations/${index}/keys/${at}/from`, `Key field ${key.from} is not described by ${from.label}.`)
      if (to && !sources.find(source => source.instanceId === to.id)?.description.fields.some(field => field.pointer === key.to)) add(`/relations/${index}/keys/${at}/to`, `Key field ${key.to} is not described by ${to.label}.`)
    }
    if (relation.cardinality === 'one-to-many' && !relation.output) add(`/relations/${index}/output`, 'Choose a list column for children.')
    if (relation.cardinality === 'one-to-many' && relation.output && !plan.columns.some(column => column.id === relation.output && column.list)) add(`/relations/${index}/output`, 'Children output must be a list column.')
  }
  for (const [index, stage] of plan.stages.entries()) {
    const columnsHere = outputPlanColumns({ ...plan, stages: plan.stages.slice(0, index) })
    const here = (id: string) => columnsHere.find(column => column.id === id)
    if (!PANEL_CAPABILITIES.operations.some(operation => operation.id === stage.op)) add(`/stages/${index}/op`, `Operation ${stage.op} is unavailable.`)
    if (stage.op === 'summarize') {
      if (++summarized > 3) add(`/stages/${index}`, 'A panel can summarize at most three times.')
      for (const [at, by] of stage.by.entries()) if (!available.has(by.column)) add(`/stages/${index}/by/${at}/column`, `Column ${by.column} is unavailable here.`)
      for (const [at, by] of stage.by.entries()) if (by.bucket && by.bucket !== 'value' && here(by.column)?.type !== 'datetime') add(`/stages/${index}/by/${at}/bucket`, 'A time bucket needs a datetime column.')
      for (const [at, measure] of stage.measures.entries()) {
        if (measure.column && !available.has(measure.column)) add(`/stages/${index}/measures/${at}/column`, `Column ${measure.column} is unavailable here.`)
        if (['sum', 'average', 'median', 'percentile', 'minimum', 'maximum'].includes(measure.kind) && !measure.column) add(`/stages/${index}/measures/${at}/column`, 'This measure needs a column.')
        if (['sum', 'average', 'median', 'percentile', 'minimum', 'maximum'].includes(measure.kind) && measure.column && here(measure.column)?.type !== 'number') add(`/stages/${index}/measures/${at}/column`, 'This measure needs a number column.')
        if (['earliest', 'latest'].includes(measure.kind) && measure.column && here(measure.column)?.type !== 'datetime') add(`/stages/${index}/measures/${at}/column`, 'This measure needs a date column.')
        const unit = measure.column ? here(measure.column)?.unit : undefined
        if (typeof unit === 'object' && ['sum', 'average', 'minimum', 'maximum', 'median', 'percentile'].includes(measure.kind)
          && !stage.by.some(group => group.column === unit.column)
          && !plan.stages.slice(0, index).some(previous => previous.op === 'filter' && fixesUnit(previous.where, unit.column))) add(`/stages/${index}/measures/${at}/column`, 'Group or filter by the unit column before totaling mixed currencies.')
        if (measure.share && typeof unit === 'object' && !plan.stages.slice(0, index).some(previous => previous.op === 'filter' && fixesUnit(previous.where, unit.column))) add(`/stages/${index}/measures/${at}/share`, 'A share of total needs one fixed currency.')
        for (const ref of measure.where ? predicateColumns(measure.where) : []) if (!available.has(ref)) add(`/stages/${index}/measures/${at}/where`, `Filter column ${ref} is unavailable here.`)
        if (measure.kind === 'percentile' && !measure.percentile) add(`/stages/${index}/measures/${at}/percentile`, 'Choose a percentile from 1 to 99.')
        if (measure.kind === 'count-where' && !measure.where) add(`/stages/${index}/measures/${at}/where`, 'Count where needs a filter.')
        if (measure.previous && !stage.by.some(by => by.bucket && by.bucket !== 'value')) add(`/stages/${index}/measures/${at}/previous`, 'Previous change needs a time bucket.')
      }
      if (stage.fill && (stage.by.length !== 1 || !stage.by[0]?.bucket || stage.by[0].bucket === 'value')) add(`/stages/${index}/fill`, 'Filling empty buckets needs one time group.')
      if (stage.pivot) {
        const column = plan.columns.find(column => column.id === stage.pivot?.column)
        if (!column?.choices || !stage.by.some(by => by.column === stage.pivot?.column)) add(`/stages/${index}/pivot/column`, 'Pivot needs a grouped enum column with declared choices.')
        if (!stage.measures.some(measure => measure.id === stage.pivot?.measure)) add(`/stages/${index}/pivot/measure`, 'Pivot measure is unavailable.')
      }
      available = new Set([...stage.by.map(by => by.column), ...stage.measures.flatMap(measure => [measure.id, ...(measure.previous ? [`${measure.id}Previous`] : [])])])
      continue
    }
    if (stage.op === 'compute') {
      for (const [at, computed] of stage.columns.entries()) {
        const refs = (expression: typeof computed.expression): string[] => expression.kind === 'column' || expression.kind === 'choice' ? [expression.column]
          : expression.kind === 'arithmetic' ? [...refs(expression.left), ...refs(expression.right)]
          : expression.kind === 'duration' ? [...refs(expression.start), ...refs(expression.end)]
          : expression.kind === 'coalesce' || expression.kind === 'min' || expression.kind === 'max' ? expression.values.flatMap(refs) : []
        for (const ref of refs(computed.expression)) if (!available.has(ref)) add(`/stages/${index}/columns/${at}/expression`, `Column ${ref} is unavailable here.`)
        if (computed.expression.kind === 'arithmetic' || computed.expression.kind === 'min' || computed.expression.kind === 'max') {
          for (const ref of refs(computed.expression)) if (here(ref)?.type !== 'number') add(`/stages/${index}/columns/${at}/expression`, `${ref} must be numeric.`)
          const units = refs(computed.expression).map(ref => here(ref)?.unit).filter(unit => unit !== undefined)
          if (units.some(unit => typeof unit === 'object') && !plan.stages.slice(0, index).some(previous => previous.op === 'filter' && units.some(unit => typeof unit === 'object' && fixesUnit(previous.where, unit.column)))) add(`/stages/${index}/columns/${at}/expression`, 'Fix a per-row currency before arithmetic.')
          if (new Set(units.map(unit => JSON.stringify(unit))).size > 1) add(`/stages/${index}/columns/${at}/expression`, 'Arithmetic cannot mix units.')
        }
        if (computed.expression.kind === 'duration') for (const ref of refs(computed.expression)) if (here(ref)?.type !== 'datetime') add(`/stages/${index}/columns/${at}/expression`, `${ref} must be a datetime.`)
        if (available.has(computed.id)) add(`/stages/${index}/columns/${at}/id`, `Column ${computed.id} already exists.`)
      }
      for (const computed of stage.columns) available.add(computed.id)
      continue
    }
    if (stage.op === 'expand') {
      if (!available.has(stage.column) || !here(stage.column)?.list) add(`/stages/${index}/column`, 'Expand needs a list column.')
      available.add(stage.output)
      continue
    }
    if (stage.op === 'overlap') {
      if (++overlapped > 1) add(`/stages/${index}`, 'A panel can overlap once.')
      for (const id of [stage.start, stage.end]) if (!available.has(id) || here(id)?.type !== 'datetime') add(`/stages/${index}`, `${id} must be a date column.`)
      if (stage.partition && !available.has(stage.partition)) add(`/stages/${index}/partition`, 'Partition column is unavailable.')
      available = new Set([...available, ...[...available].map(id => `right_${id}`), 'overlapDuration'])
      continue
    }
    for (const id of predicateColumns(stage.where)) {
      if (!id || !available.has(id)) add(`/stages/${index}/where`, `Filter names an unavailable column: ${id || '(invalid pointer)'}.`)
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
        && !plan.stages.slice(0, index).some(previous => previous.op === 'filter' && fixesUnit(previous.where, (column.unit as { column: string }).column))) add(`/stages/${index}/where`, `${column.label} has per-row units; compare only after fixing one unit.`)
    }
    check(stage.where)
  }
  const finalColumn = (id: string) => outputPlanColumns(plan).find(column => column.id === id)
  for (const [index, sort] of (plan.sort ?? []).entries()) {
    const column = finalColumn(sort.column)
    if (!column) add(`/sort/${index}/column`, `Sort column ${sort.column} is unavailable.`)
    else if (typeof column.unit === 'object' && !plan.group?.some(group => group.column === (column.unit as { column: string }).column)) add(`/sort/${index}/column`, `${column.label} has mixed units; group by its unit first.`)
  }
  for (const [index, group] of (plan.group ?? []).entries()) {
    const column = finalColumn(group.column)
    if (!column) add(`/group/${index}/column`, `Group column ${group.column} is unavailable.`)
    else if (group.bucket && group.bucket !== 'value' && column.type !== 'datetime') add(`/group/${index}/bucket`, 'Time buckets require a date column.')
    if (group.order === 'explicit' && !group.values?.length) add(`/group/${index}/values`, 'An explicit order needs values.')
  }
  if (plan.view.kind === 'board' && (plan.group?.length !== 1 || finalColumn(plan.group[0]!.column)?.type !== 'enum')) add('/view/kind', 'A board needs one enum group.')
  for (const key of ['field', 'x', 'series'] as const) {
    const ref = plan.view[key]
    if (ref !== undefined && !finalColumn(ref)) add(`/view/${key}`, `View column ${ref} is unavailable.`)
  }
  if (plan.view.aggregate && plan.view.aggregate !== 'count' && finalColumn(plan.view.field ?? '')?.type !== 'number') add('/view/field', 'This aggregate needs a number column.')
  const measured = finalColumn(plan.view.field ?? '')
  if (plan.view.aggregate && plan.view.aggregate !== 'count' && typeof measured?.unit === 'object'
    && !plan.stages.some(stage => stage.op === 'filter' && fixesUnit(stage.where, (measured.unit as { column: string }).column))) add('/view/field', 'An aggregate needs one fixed unit; filter by currency first.')
  if (plan.view.kind === 'chart' && !['datetime', 'enum'].includes(finalColumn(plan.view.x ?? '')?.type ?? '')) add('/view/x', 'A chart needs a date or enum axis.')
  if (plan.view.shape === 'line' && finalColumn(plan.view.x ?? '')?.type !== 'datetime') add('/view/x', 'A line chart needs a date axis.')
  if (plan.view.shape === 'bar' && finalColumn(plan.view.x ?? '')?.type !== 'enum') add('/view/x', 'A bar chart needs an enum axis.')
  if (plan.view.series && finalColumn(plan.view.series)?.type !== 'enum') add('/view/series', 'A series needs an enum column.')
  if (plan.view.trend && plan.view.kind !== 'stat') add('/view/trend', 'A trend belongs on a stat view.')
  const checkReference = (reference: NonNullable<PanelPlan['actions']>['press'], path: string): void => {
    if (!reference) return
    if (reference.source && !plan.sources.some(source => source.id === reference.source)) add(path, `Source ${reference.source} is unavailable.`)
    if (reference.kind === 'link' && (!reference.column || columnAt(plan, reference.column)?.type !== 'link')) add(path, 'Choose a link column.')
    if (reference.kind !== 'link' && reference.column) add(path, 'Only a link reference names a column.')
  }
  checkReference(plan.actions?.press, '/actions/press')
  for (const [index, button] of (plan.actions?.buttons ?? []).entries()) if (button.kind === 'open') checkReference(button.reference, `/actions/buttons/${index}/reference`)
  if (plan.view.compare && !plan.view.trend) add('/view/compare', 'A comparison needs a trend.')
  for (const [index, requirement] of (plan.requirements ?? []).entries()) {
    if (['covered', 'partial'].includes(requirement.status)) for (const path of requirement.paths ?? []) {
      if (!/^\/(sources|columns|stages|sort|group|view|actions)(\/|$)/.test(path)) add(`/requirements/${index}/paths`, `${path} is not a plan part.`)
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
  return sources.filter(source => plan.sources.find(entry => entry.id === source.instanceId)?.role === 'primary').flatMap(source => (source.result?.records ?? []).map(record => {
    const values = Object.fromEntries(plan.columns.map(column => [column.id, mappedValue(column, source, record)]))
    return {
    id: `${source.instanceId}:${record.ref.recordId}`,
    sourceRecords: { [source.instanceId]: record.ref },
    sourceValues: { [source.instanceId]: values },
    sourceFieldValues: { [source.instanceId]: Object.fromEntries((source.description.writable ?? []).flatMap(field => {
      const value = readDataPointer(record.data, field.field)
      return value === MISSING ? [] : [[field.field, value]]
    })) },
    ...(record.writableFields ? { sourceWritableFields: { [source.instanceId]: record.writableFields } } : {}),
    values,
    records: [record.ref],
    ...(source.query.source.pluginId === 'core' && source.query.source.sourceId.startsWith('dataset:')
      && source.description.dataset?.feeder === 'agent'
      ? { correctableDatasetId: source.query.source.sourceId.slice(8) } : {}),
    recordItems: [{ ref: record.ref, ...(record.taskId ? { taskId: record.taskId } : {}), ...(record.action ? { action: record.action } : {}), ...(record.actions ? { actions: record.actions } : {}), ...(record.target ? { target: record.target } : {}) }],
    ...(record.taskId ? { taskId: record.taskId } : {}),
    ...(record.action ? { action: record.action } : {}),
    ...(record.actions ? { actions: record.actions } : {}),
    ...(record.target ? { target: record.target } : {}),
  }}))
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

export { relatePanelRows }
export function runPlanStages(plan: PanelPlan, rows: readonly PlanRow[], evaluationTime = Date.now(), incomplete = false): { rows: PlanRow[]; counts: PlanStageCount[]; problems: PlanProblem[] } {
  let current = [...rows]
  let meaning = 'one row per source item'
  const counts: PlanStageCount[] = []
  const problems: PlanProblem[] = []
  for (const [index, stage] of plan.stages.entries()) {
    const input = current.length
    try {
      switch (stage.op) {
        case 'filter': current = current.filter(row => matchesPlanFilter(row, stage.where)); break
        case 'compute': current = current.map(row => ({ ...row, values: { ...row.values, ...Object.fromEntries(stage.columns.map(column => [column.id, evaluateExpression(column.expression, row, evaluationTime)])) } })); break
        case 'summarize': {
          const result = summarizeRows(plan, stage, current, matchesPlanFilter, incomplete)
          current = result.rows.map(row => ({ ...row, summaryStage: index }))
          for (const message of result.errors) problems.push({ path: `/stages/${index}`, message, severity: 'error' })
          break
        }
        case 'expand': current = expandRows(plan, current, stage); break
        case 'overlap': current = overlapRows(current, stage); break
      }
    } catch (error) { problems.push({ path: `/stages/${index}`, message: error instanceof Error ? error.message : 'Stage failed.', severity: 'error' }); current = []; break }
    if (stage.op === 'summarize') meaning = `one row per ${stage.by.map(by => by.column).join(' and ') || 'all rows'}`
    if (stage.op === 'overlap') meaning = 'one row per overlapping pair'
    if (stage.op === 'expand') meaning = `one row per ${stage.column} element`
    counts.push({ path: `/stages/${index}`, input, output: current.length, meaning })
    if (current.length > 25000) { problems.push({ path: `/stages/${index}`, message: 'Intermediate row budget exceeded.', severity: 'error' }); current = []; break }
  }
  return { rows: current, counts, problems }
}

export { sortPlanRows, groupPlanRows } from './planShaping'

/** A drill-down begins before the summary it explains. Phase 05 can pass its summary stage and measure filter here. */
export function deriveDrilldownPlan(plan: PanelPlan, rows: readonly Pick<PlanRow, 'values'>[], options: {
  stageIndex?: number
  measureFilter?: DataPredicate
  summaryKeys?: Record<string, DataValue>
  summaryBuckets?: { column: string; bucket: 'day' | 'week' | 'month'; value: DataValue }[]
  zone?: string
} = {}): PanelPlan {
  const stages = plan.stages.slice(0, options.stageIndex ?? plan.stages.length)
  const predicates: DataPredicate[] = []
  for (const group of plan.group ?? []) {
    const values = [...new Map(rows.map(row => [JSON.stringify(row.values[group.column] ?? null), row.values[group.column] ?? null])).values()]
    predicates.push({ kind: 'comparison', left: { address: { from: 'item', pointer: `/${group.column}` } },
      operator: 'in', right: { address: { from: 'literal', value: values } } })
  }
  for (const [column, value] of Object.entries(options.summaryKeys ?? {})) predicates.push({ kind: 'comparison',
    left: { address: { from: 'item', pointer: `/${column}` } }, operator: 'eq', right: { address: { from: 'literal', value } } })
  for (const item of options.summaryBuckets ?? []) {
    if (item.value === null) {
      predicates.push({ kind: 'comparison', left: { address: { from: 'item', pointer: `/${item.column}` } },
        operator: 'eq', right: { address: { from: 'literal', value: null } } })
      continue
    }
    const precision = plan.columns.find(column => column.id === item.column)?.precision ?? 'instant'
    const bounds = bucketBounds(item.value, item.bucket, options.zone ?? plan.time.zone, precision)
    if (!bounds) throw new Error(`Invalid ${item.bucket} bucket for ${item.column}`)
    for (const [operator, value] of [['gte', bounds.start], ['lt', bounds.end]] as const) predicates.push({ kind: 'comparison',
      left: { address: { from: 'item', pointer: `/${item.column}` } }, operator,
      right: { address: { from: 'literal', value } } })
  }
  if (options.measureFilter) predicates.push(options.measureFilter)
  const where: DataPredicate = predicates.length === 1 ? predicates[0]! : { kind: 'all', predicates }
  const filtered = !predicates.length ? stages : [...stages, { op: 'filter' as const, where }]
  return { ...plan, title: `${plan.title} · rows`, group: [], view: { kind: 'table' }, stages: filtered }
}

export function describePanelPlan(plan: PanelPlan, sources: readonly PlanSource[] = []): string[] {
  const labels = plan.sources.map(source => {
    const resolved = sources.find(candidate => candidate.instanceId === source.id)
    const scope = resolved?.query.scope
    return `${source.label}${scope?.connectionId ? ` through account ${resolved?.accountLabel ?? scope.connectionId}` : ''}`
  })
  const describePredicate = (predicate: DataPredicate): string => {
    if (predicate.kind !== 'comparison') return predicate.predicates.map(describePredicate).join(predicate.kind === 'all' ? ' and ' : ' or ')
    const address = predicate.left.address
    const id = address.from === 'item' ? pointerColumn(address.pointer) : undefined
    const name = columnAt(plan, id ?? '')?.label ?? id ?? 'a value'
    const right = predicate.right?.address
    const value = right?.from === 'literal' ? JSON.stringify(right.value)
      : right?.from === 'context' ? right.name === 'viewer' ? 'you'
        : right.name === 'now' ? `${right.offset ?? 'P0D'} from now`
          : right.name === 'calendar' ? `${right.boundary}${right.offset ? ` ${right.offset}` : ''}` : 'workspace links'
        : 'another value'
    return predicate.operator === 'missing' ? `${name} is missing`
      : predicate.operator === 'present' ? `${name} is present`
        : `${name} ${predicate.operator} ${value}`
  }
  const selectedPress = plan.actions?.press
  const pressedSource = sources.filter(source => !selectedPress?.source || source.instanceId === selectedPress.source)
  const pressedKinds = [...new Set(pressedSource.flatMap(source => source.description.targets?.map(target => target.kind) ?? []))]
  const pressedRecord = pressedKinds.length === 1 ? `the ${pressedKinds[0]!.split('.').at(-1)!.replaceAll('-', ' ')}` : 'the source record'
  const finalStage = [...plan.stages].reverse().find(stage => stage.op === 'summarize' || stage.op === 'expand' || stage.op === 'overlap')
  const rowMeaning = finalStage?.op === 'summarize' ? `One row per ${finalStage.by.map(by => columnAt(plan, by.column)?.label ?? by.column).join(' and ') || 'whole selection'}.`
    : finalStage?.op === 'overlap' ? 'One row per pair of overlapping intervals.'
      : finalStage?.op === 'expand' ? `One row per ${finalStage.column} element.` : `One row per record from ${labels.join(' and ')}.`
  return [
    rowMeaning,
    ...sources.map(source => {
      const declared = source.description.reach
      const selected = declared ? readDataPointer(source.query.scope.parameters, declared.parameter) : MISSING
      const reach = declared ? Array.isArray(selected)
        ? selected.length ? `${selected.length} chosen ${declared.itemPlural}: ${selected.join(', ')}` : declared.empty
        : declared.default.replace('{account}', source.accountLabel ?? 'selected')
        : source.description.consistency
      return `${source.label} reaches ${reach}.`
    }),
    `Columns: ${plan.columns.map(column => column.label).join(', ') || 'none'}.`,
    ...plan.columns.flatMap(column => (column.choices ?? []).flatMap(choice => Object.entries(choice.writeValues ?? {}).map(([sourceId, value]) =>
      `Dropping a ${sources.find(source => source.instanceId === sourceId)?.label ?? sourceId} record on ${choice.label} sets ${column.label} to ${JSON.stringify(value)}.`))),
    ...(plan.relations ?? []).map(relation => `${relation.kind === 'equivalence' ? 'Merge equivalent' : relation.cardinality === 'one-to-many' ? 'Attach children from' : 'Look up'} ${relation.to} through ${relation.id}${relation.unmatched === 'drop' ? '; drop unmatched rows' : '; keep unmatched rows'}.`),
    ...plan.stages.map(stage => stage.op === 'filter' ? `Keep rows where ${describePredicate(stage.where)}.`
      : stage.op === 'compute' ? `Compute ${stage.columns.map(column => column.label).join(', ')}.`
      : stage.op === 'summarize' ? `One row per ${stage.by.map(by => columnAt(plan, by.column)?.label ?? by.column).join(' and ') || 'all rows'}; measure ${stage.measures.map(measure => measure.label).join(', ')}.`
      : stage.op === 'expand' ? `Expand ${stage.column} into one row per element.` : `One row per overlapping pair from ${stage.start} and ${stage.end}.`),
    ...(sources.some(source => source.query.take && plan.stages.length) ? ['A source limit applies before the panel filter.'] : []),
    ...(plan.sort?.length ? [`Sort by ${plan.sort.map(item => `${columnAt(plan, item.column)?.label ?? item.column} ${item.direction === 'desc' ? 'newest or highest first' : 'oldest or lowest first'}`).join(', ')}.`] : []),
    ...(plan.group?.length ? [`Group by ${plan.group.map(item => columnAt(plan, item.column)?.label ?? item.column).join(' then ')}.`] : []),
    ...(plan.limit ? [`Show at most ${plan.limit} rows after filtering and sorting.`] : []),
    ...(plan.actions?.press ? [`Pressing a row opens ${plan.actions.press.kind === 'link' ? columnAt(plan, plan.actions.press.column ?? '')?.label ?? 'a link' : plan.actions.press.kind === 'task' ? 'its task' : pressedRecord} in ${plan.actions.press.prefer === 'refPanel' ? 'a side panel' : plan.actions.press.prefer === 'pane' ? 'a task pane' : plan.actions.press.prefer === 'route' ? 'a full page' : plan.actions.press.prefer === 'overlay' ? 'an overlay' : 'the browser'}.`] : []),
  ]
}

/** A renderer adapter over the Node's plan rows. The Node remains the only executor. */
export function displayPlanRun(plan: PanelPlan, rows: readonly PlanRow[]): { schema: DashboardDisplaySchema; fields: DashboardDisplayField[]; rows: DashboardDisplayRow[] } {
  const fields: DashboardDisplayField[] = outputPlanColumns(plan).map(column => ({
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
      records: row.records,
      ...(row.sourceFieldValues ? { sourceFieldValues: row.sourceFieldValues } : {}),
      ...(row.sourceWritableFields ? { sourceWritableFields: row.sourceWritableFields } : {}),
      ...(row.recordItems ? { recordItems: row.recordItems } : {}),
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.action ? { action: row.action } : {}),
      ...(row.actions ? { actions: row.actions } : {}),
      ...(row.target ? { target: row.target } : {}),
      ...(row.partial ? { partial: row.partial } : {}),
      ...(row.summaryStage !== undefined ? { summaryStage: row.summaryStage } : {}),
      ...(row.correctableDatasetId ? { correctableDatasetId: row.correctableDatasetId } : {}),
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

export { upgradePanelContent } from './upgrade'
