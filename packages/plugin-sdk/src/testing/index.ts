// Published entry point for `acorn-plugin-sdk/testing`. Its declaration is ./public.ts, copied to
// dist/testing.d.ts. The field lists come from ./sourceFields.json, which tools/arch/sourceFields.test.ts
// writes from each source's own description and fails on when it's stale.
import { validateDataValue, type DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { DataField, DataPredicate, DataSourceInputHandle, DataSourceResult } from 'acorn-plugin-types'
import type { InputRecord } from '../data/public.ts'
import { runDerived } from '../data/derived.ts'
import type { fixtures as Fixtures, testDerivedSource as TestDerivedSource } from './public.ts'
import lists from './sourceFields.json' with { type: 'json' }

type FieldList = { name: string; schema: DataSchema; fields: DataField[] }
const sourceFields = lists as unknown as Record<string, FieldList>

export const testDerivedSource: typeof TestDerivedSource = async (source, inputs, options = {}) => {
  const { definition, description } = source
  const given = inputs as Record<string, InputRecord[] | undefined>
  for (const name of Object.keys(given)) if (!Object.hasOwn(definition.inputs, name)) throw new Error(`${definition.name} has no input named ${name}`)
  const parameters = options.parameters ?? {}
  validateDataValue(parameters, description.parameters)
  const hosts: Record<string, DataSourceInputHandle> = {}
  for (const [name, input] of Object.entries(definition.inputs)) {
    const records = given[name]
    if (records) hosts[name] = fakeInput(input.source, records)
    else if (!input.optional) throw new Error(`testDerivedSource needs records for the input ${name}`)
  }
  const run = await runDerived(definition as never, description.schema, hosts, {
    parameters, evaluationTime: options.evaluationTime ?? Date.now(), mode: options.mode ?? 'execution', signal: new AbortController().signal,
  })
  return { rows: run.records.map(({ recordId, ...record }) => ({ id: recordId, ...record })) as never, dropped: run.dropped, completeness: run.completeness }
}

/** An input that answers from the test's records. It refuses a `where` the real source couldn't run. */
function fakeInput(source: string, records: InputRecord[]): DataSourceInputHandle {
  const list = sourceFields[source]
  return {
    describe: async () => ({
      schema: list?.schema ?? { type: 'object' }, fields: list?.fields ?? [], parameters: { type: 'object' }, parameterFields: [],
      operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] }, revision: 'test', consistency: 'Test records',
    }),
    identity: async () => ({}),
    options: async () => ({ options: [], exhausted: true }),
    query: async ({ predicate } = {}) => {
      const tests = comparisons(predicate)
      for (const { pointer } of tests) {
        const known = list?.fields.find(item => item.pointer === pointer)
        if (list && !known?.query?.operators.includes('eq')) throw new Error(`${list.name} can't be filtered on ${pointer}. Filter the records in your query instead.`)
      }
      const matched = records.filter(record => tests.every(({ pointer, value }) => readDataPointer(record.data as DataValue, pointer) === value))
      return { records: matched as unknown as DataSourceResult['records'], revision: 'test', readTime: 0,
        completeness: { kind: 'complete' }, mode: 'execution', evaluationTime: 0 }
    },
  }
}

function comparisons(predicate: DataPredicate | undefined): { pointer: string; value: unknown }[] {
  if (!predicate) return []
  if (predicate.kind !== 'comparison') return predicate.predicates.flatMap(comparisons)
  const { left, right } = predicate
  if (left.address.from !== 'item' || right?.address.from !== 'literal') throw new Error('A fake input supports only `where`')
  return [{ pointer: left.address.pointer, value: right.address.value }]
}

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────

export const fixtures: typeof Fixtures = (source, partials) => {
  const list = sourceFields[source]
  if (!list) throw new Error(`There's no field list for ${source}. Sources with one: ${Object.keys(sourceFields).join(', ')}.`)
  const split = source.indexOf(':')
  const ref = { pluginId: source.slice(0, split), sourceId: source.slice(split + 1) }
  const urlField = list.fields.find(item => item.display?.role === 'url' && !item.pointer.slice(1).includes('/'))?.pointer.slice(1)
  return partials.map((partial, index) => {
    checkKeys(partial, list.schema, list.name, '')
    const data = merge(defaults(list.schema), partial as DataValue) as Record<string, DataValue>
    if (urlField && data[urlField] === '') data[urlField] = `https://example.test/${ref.sourceId}/${index + 1}`
    try { validateDataValue(data, list.schema) } catch (error) {
      throw new Error(`${list.name} record ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const url = urlField && typeof data[urlField] === 'string' ? data[urlField] : undefined
    return { ref: { ...ref, recordId: `${ref.sourceId}-${index + 1}` }, data,
      ...(url ? { display: { url }, action: { verb: 'openUrl' as const, url } } : {}) }
  })
}

function checkKeys(value: unknown, schema: DataSchema, name: string, path: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !schema.properties) return
  const known = Object.keys(schema.properties)
  for (const [key, item] of Object.entries(value)) {
    const property = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
    if (property) { checkKeys(item, property, name, `${path}${key}.`); continue }
    const guess = closest(key, known)
    throw new Error(`${name} have no field \`${path}${key}\`.${guess ? ` Did you mean \`${path}${guess}\`?` : ''}`)
  }
}

/** The likeliest intended name: one that contains the other and is at least half its length, else the
 *  nearest by edit distance. Case and punctuation don't count, so `head_branch` finds `headBranch`. */
function closest(key: string, known: string[]): string | undefined {
  const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = plain(key)
  const contained = known.filter(name => {
    const candidate = plain(name)
    const [short, long] = candidate.length < wanted.length ? [candidate, wanted] : [wanted, candidate]
    return long.includes(short) && short.length * 2 >= long.length
  })
  if (contained.length) return contained.sort((a, b) => b.length - a.length)[0]
  const scored = known.map(name => [name, distance(wanted, plain(name))] as const).sort((a, b) => a[1] - b[1])[0]
  return scored && scored[1] <= Math.max(2, wanted.length / 3) ? scored[0] : undefined
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = row
  }
  return previous[b.length]!
}

/** A value that passes the schema: null where allowed, the first enum value, then the type's zero. */
function defaults(schema: DataSchema): DataValue {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.includes('null')) return null
  if (schema.enum?.length) return schema.enum[0]!
  switch (types[0]) {
    case 'string': return ''
    case 'number': case 'integer': return 0
    case 'boolean': return false
    case 'array': return []
    case 'object': return Object.fromEntries((schema.required ?? []).map(key => [key, defaults(schema.properties?.[key] ?? { type: 'null' })]))
    default: return null
  }
}

function merge(base: DataValue, over: DataValue): DataValue {
  const plain = (value: DataValue): value is Record<string, DataValue> => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!plain(base) || !plain(over)) return over
  const merged = { ...base }
  for (const [key, value] of Object.entries(over)) merged[key] = Object.hasOwn(base, key) ? merge(base[key]!, value) : value
  return merged
}
