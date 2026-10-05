// The derived source helper behind `acorn-plugin-sdk/data`. It runs in a plugin's node half and answers
// the host's source operations (docs/data-sources/derived-sources.md) so an author writes only the
// logic. The record check is the host's own validator, inlined at build time, so a record the SDK
// keeps is one the host keeps too.
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import type { DataPredicate, DataRecordRef, DataSchema, DataSourceInputHandle, DataSourceRegistration, DataSourceResult } from 'acorn-plugin-types'
import type {
  DerivedQueryArgs, DerivedRecord, DerivedSource, DerivedSourceDefinition, FieldChoice, FieldOptions, FieldSpec, FieldSpecs,
  InputHandle, InputQuery, InputRead, InputRecord, InputSpecs, field as Field,
} from './public.ts'

// ── Fields ────────────────────────────────────────────────────────────────────────────────────────

type Kind = 'text' | 'number' | 'boolean' | 'datetime' | 'enum' | 'status' | 'person' | 'link'

function build(kind: Kind, type: 'string' | 'number' | 'boolean', options: FieldOptions & { choices?: readonly FieldChoice[] }): FieldSpec<unknown> {
  const { label, description, role, unit, precision, list, nullable, choices } = options
  const enumValues = choices?.map(choice => choice.id)
  const item: DataSchema = enumValues ? { type, enum: enumValues } : { type }
  const base = list ? 'array' : type
  const schema: DataSchema = {
    type: nullable ? [base, 'null'] : base,
    // A nullable enum has to list null too, or the validator refuses the null it allows.
    ...(list ? { items: item } : enumValues ? { enum: nullable ? [...enumValues, null] : enumValues } : {}),
  }
  const display = { kind: choices && role === 'status' ? 'status' as const : kind,
    ...(role ? { role } : {}), ...(unit ? { unit } : {}), ...(precision ? { precision } : {}), ...(list ? { list } : {}) }
  return { schema, field: { label, ...(description ? { description } : {}), origin: 'declared', display,
    ...(choices ? { choices: { kind: 'static' as const, values: choices.map(choice => ({ ...choice })) } } : {}) } }
}

export const field: typeof Field = {
  text: options => build('text', 'string', options) as never,
  number: options => build('number', 'number', options) as never,
  boolean: options => build('boolean', 'boolean', options) as never,
  datetime: options => build('datetime', 'number', options) as never,
  choice: options => build('enum', 'string', options) as never,
  person: options => build('person', 'string', options) as never,
  link: options => build('link', 'string', options) as never,
}

/** A field name as a JSON pointer: `~` and `/` are escaped. */
export const pointerOf = (name: string) => `/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`

function describeFields(specs: FieldSpecs) {
  const entries = Object.entries(specs)
  return {
    schema: { type: 'object', additionalProperties: false, properties: Object.fromEntries(entries.map(([name, spec]) => [name, spec.schema])),
      required: entries.map(([name]) => name) } satisfies DataSchema,
    fields: entries.map(([name, spec]) => ({ pointer: pointerOf(name), ...spec.field })),
  }
}

// FNV-1a. The revision only has to change when the declaration does; it isn't a security boundary.
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193)
  return (value >>> 0).toString(36)
}

// ── Inputs ────────────────────────────────────────────────────────────────────────────────────────

/** The most records one `all` reads from an input: the host's own cap on a query. */
export const INPUT_RECORD_BUDGET = 5000

export function wherePredicate(where: InputQuery['where']): DataPredicate | undefined {
  const tests = Object.entries(where ?? {})
  if (!tests.length) return undefined
  return { kind: 'all', predicates: tests.map(([key, value]) => ({ kind: 'comparison' as const, operator: 'eq' as const,
    left: { address: { from: 'item' as const, pointer: key.startsWith('/') ? key : pointerOf(key) } },
    right: { address: { from: 'literal' as const, value } } })) }
}

/** What one run learned about its inputs: whether an `all` stopped at the budget, and every record it
 *  saw, so `opens` can find the record a row points at. */
export type InputLedger = { cut: boolean; seen: Map<string, InputRecord> }
const refKey = (ref: DataRecordRef) => JSON.stringify([ref.pluginId, ref.sourceId, ref.connectionId ?? null, ref.recordId])

/** Wrap a host handle (or a test's fake) in the author-facing one. */
export function inputHandle(host: DataSourceInputHandle, ledger: InputLedger): InputHandle {
  const read = async (query: InputQuery & { cursor?: string; pageSize?: number } = {}): Promise<InputRead> => {
    const { where, ...rest } = query
    const predicate = wherePredicate(where)
    const result = await host.query({ ...rest, ...(predicate ? { predicate } : {}) })
    const records = result.records.map(record => {
      const data = record.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`An input record isn't an object: ${record.ref.recordId}`)
      const kept: InputRecord = { ref: record.ref, data, ...(record.display ? { display: record.display } : {}),
        ...(record.taskId ? { taskId: record.taskId } : {}), ...(record.action ? { action: record.action } : {}) }
      ledger.seen.set(refKey(record.ref), kept)
      return kept
    })
    return { records, completeness: result.completeness }
  }
  return {
    describe: () => host.describe(),
    identity: () => host.identity(),
    query: read,
    all: async (query = {}) => {
      const records: InputRecord[] = []
      let page = await read({ ...query, pageSize: 100 })
      records.push(...page.records)
      while (page.completeness.kind === 'more' && records.length < INPUT_RECORD_BUDGET) {
        page = await read({ ...query, pageSize: 100, cursor: page.completeness.cursor })
        records.push(...page.records)
      }
      if (page.completeness.kind !== 'more') return { records, completeness: page.completeness }
      ledger.cut = true
      return { records, completeness: { kind: 'incomplete', cause: 'host-budget' } }
    },
  }
}

// ── Running the logic ─────────────────────────────────────────────────────────────────────────────

type PageRecord = Omit<DataSourceResult['records'][number], 'ref'> & { recordId: string }
export type DerivedRun = {
  records: PageRecord[]
  dropped: { id: string; reason: string }[]
  completeness: DataSourceResult['completeness']
}

/** The press action for a row that opens an input record: the record's own link or task, using only
 *  verbs the host accepts from any plugin. */
function opening(ledger: InputLedger, ref: DataRecordRef | undefined): Partial<PageRecord> {
  const upstream = ref && ledger.seen.get(refKey(ref))
  if (!upstream) return {}
  if (upstream.action?.verb === 'openTask' && upstream.taskId) return { action: upstream.action, taskId: upstream.taskId }
  const url = upstream.action?.verb === 'openUrl' ? upstream.action.url : upstream.display?.url
  return url ? { action: { verb: 'openUrl', url }, display: { url } } : {}
}

/** Check each record the way the host does, drop the ones that fail, and say why. A shared id is a
 *  host failure, not a dropped record, so it throws. */
export function checkRecords(rows: DerivedRecord<FieldSpecs>[], schema: DataSchema, ledger: InputLedger): DerivedRun {
  const records: PageRecord[] = []
  const dropped: DerivedRun['dropped'] = []
  const ids = new Set<string>()
  for (const row of rows) {
    if (typeof row.id !== 'string' || !row.id || row.id.length > 200) {
      dropped.push({ id: String(row.id), reason: 'An id is 1 to 200 characters of text' })
      continue
    }
    if (ids.has(row.id)) throw new Error(`Two records share the id ${row.id}`)
    ids.add(row.id)
    try { validateDataValue(row.data, schema) } catch (error) {
      dropped.push({ id: row.id, reason: error instanceof Error ? error.message : String(error) })
      continue
    }
    records.push({ recordId: row.id, data: row.data as PageRecord['data'], ...opening(ledger, row.opens) })
  }
  const completeness: DataSourceResult['completeness'] = ledger.cut ? { kind: 'incomplete', cause: 'host-budget' }
    : dropped.length ? { kind: 'incomplete', cause: 'invalid-records', count: dropped.length }
      : { kind: 'complete' }
  return { records, dropped, completeness }
}

export class MissingInputError extends Error {}

/** Run the author's logic over a set of handles. The handler and `testDerivedSource` both come here. */
export async function runDerived(
  definition: DerivedSourceDefinition<InputSpecs, FieldSpecs, FieldSpecs>,
  schema: DataSchema,
  hosts: Readonly<Record<string, DataSourceInputHandle>> | undefined,
  args: Omit<DerivedQueryArgs<InputSpecs, FieldSpecs>, 'inputs' | 'parameters'> & { parameters: Record<string, unknown> },
): Promise<DerivedRun> {
  const ledger: InputLedger = { cut: false, seen: new Map() }
  const inputs: Record<string, InputHandle | undefined> = {}
  for (const [name, input] of Object.entries(definition.inputs)) {
    const host = hosts?.[name]
    if (!host && !input.optional) throw new MissingInputError(`Input ${name} isn't bound`)
    inputs[name] = host && inputHandle(host, ledger)
  }
  const rows = await definition.query({ ...args, inputs: inputs as never, parameters: args.parameters as never })
  return checkRecords(rows, schema, ledger)
}

// ── The source ────────────────────────────────────────────────────────────────────────────────────

const SELECTIONS = 16
const SELECTION_MS = 60_000

export function defineDerivedSource<const I extends InputSpecs, const F extends FieldSpecs, const P extends FieldSpecs = {}>(
  definition: DerivedSourceDefinition<I, F, P>,
): DerivedSource<I, F, P> {
  const own = describeFields(definition.fields)
  const parameters = describeFields(definition.parameters ?? {})
  const revision = `sdk.${hash(JSON.stringify([own, parameters]))}`
  const description = {
    schema: own.schema, fields: own.fields, parameters: parameters.schema, parameterFields: parameters.fields,
    operations: { query: true as const, options: false, details: true, incremental: false, groups: [] },
    detailSchema: own.schema, revision,
    consistency: definition.consistency ?? `Built from ${Object.values(definition.inputs).map(input => input.label).join(', ')} each time it's read.`,
    ...(definition.starterPlans ? { starterPlans: definition.starterPlans } : {}),
  }
  const generic = definition as unknown as DerivedSourceDefinition<InputSpecs, FieldSpecs, FieldSpecs>

  // A query runs the logic once and pages its result, because the host asks for a page at a time.
  // `details` answers from the newest run for the same scope, so a record read with one account is
  // never returned for a request bound to another. A scope the cache doesn't hold reads as not found.
  type Selection = { key: string; run: DerivedRun; expires: number }
  const selections = new Map<string, Selection>()
  const newest = new Map<string, { records: Map<string, PageRecord>; readTime: number }>()

  async function query(body: QueryBody, context: { inputs?: Readonly<Record<string, DataSourceInputHandle>> }, signal: AbortSignal) {
    for (const [id, entry] of selections) if (entry.expires <= Date.now()) selections.delete(id)
    const key = JSON.stringify([body.query, body.mode, body.evaluationTime])
    let id: string
    let offset = 0
    let selection: Selection | undefined
    if (body.cursor) {
      const match = /^(\w+):(\d+)$/.exec(body.cursor)
      selection = match ? selections.get(match[1]!) : undefined
      if (!match || !selection || selection.key !== key) throw new Error('This page of results has expired')
      id = match[1]!
      offset = Number(match[2])
    } else {
      const run = await runDerived(generic, own.schema, context.inputs,
        { parameters: body.query.scope.parameters, evaluationTime: body.evaluationTime, mode: body.mode, signal })
      selection = { key, run, expires: Date.now() + SELECTION_MS }
      id = hash(`${key}${Math.random()}`)
      const scope = JSON.stringify(body.query.scope)
      newest.delete(scope)
      if (newest.size >= SELECTIONS) newest.delete(newest.keys().next().value!)
      newest.set(scope, { records: new Map(run.records.map(record => [record.recordId, record])), readTime: body.evaluationTime })
    }
    const records = selection.run.records.slice(offset, offset + body.pageSize)
    const next = offset + records.length
    const more = next < selection.run.records.length
    if (more) {
      if (!selections.has(id) && selections.size >= SELECTIONS) selections.delete(selections.keys().next().value!)
      selections.set(id, selection)
    }
    return { records, revision, readTime: body.evaluationTime,
      completeness: more ? { kind: 'more', cursor: `${id}:${next}` } : selection.run.completeness }
  }

  return {
    definition,
    description,
    fetch: async (request, context) => {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      // The host invokes a source for a device or its own service. A task-confined agent credential
      // that reaches this route directly gets nothing it read.
      const { principal } = context
      if (principal.kind !== 'device' && !(principal.kind === 'internal' && principal.scope === 'service')) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
      try {
        const body = await request.json() as { operation?: string }
        switch (body.operation) {
          case 'describe': return Response.json(description)
          case 'actions': return Response.json({ actions: [] })
          case 'query': return Response.json(await query(body as QueryBody, context, request.signal))
          case 'details': {
            const { ref, scope } = body as { ref: DataRecordRef; scope: unknown }
            const run = newest.get(JSON.stringify(scope))
            const found = run?.records.get(ref.recordId)
            return Response.json(found ? { kind: 'found', data: found.data, fetchedTime: run!.readTime } : { kind: 'not-found' })
          }
          default: return Response.json({ error: 'unsupported_operation' }, { status: 400 })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return Response.json({ error: 'derived_source_failed', message }, { status: error instanceof MissingInputError ? 400 : 502 })
      }
    },
  }
}

type QueryBody = {
  operation: 'query'
  query: { scope: { parameters: Record<string, unknown> } }
  mode: DerivedQueryArgs<InputSpecs, FieldSpecs>['mode']
  evaluationTime: number
  cursor?: string
  pageSize: number
}

export function derivedSourceManifest(source: DerivedSource<InputSpecs, FieldSpecs, FieldSpecs>): DataSourceRegistration {
  const { id, name, singular, plural, handler, inputs, icon, identityScope } = source.definition
  const pointer = (role: string) => source.description.fields.find(item => item.display?.role === role)?.pointer
  const titlePointer = pointer('title')
  const urlPointer = pointer('url')
  return {
    sourceId: id, name, singular, plural, identityScope: identityScope ?? 'Built from its inputs', handler,
    ...(icon ? { icon } : {}), ...(titlePointer ? { titlePointer } : {}), ...(urlPointer ? { urlPointer } : {}),
    inputs: Object.fromEntries(Object.entries(inputs).map(([key, input]) =>
      [key, { source: input.source, label: input.label, ...(input.optional ? { optional: true } : {}) }])),
  }
}
