// What an event feed's source describes (docs/data-sources/event-feeds.md). The Node serves this, and
// the SDK's `defineEventFeed` builds the same thing so a plugin's tests read what the Node will. It
// imports no schema library, because the SDK bundles it into every plugin that declares a feed.
import type { DataSourceDescription } from './dataSources'
import type { DataField, DataOperator } from './values/dataBindings'
import type { DataSchema } from './values/dataSchemas'
import type { DataValue } from './values/dataValues'

/** A feed's caps, which are also its defaults. `appendEvents` is the most one `append` takes. */
export const DATA_FEED_LIMITS = { retentionDays: 14, maxEvents: 10_000, appendEvents: 100 } as const

/** One event a plugin appends to its feed. `time` is milliseconds since the epoch. */
export type DataFeedEvent = { id: string; time: number; data: DataValue; title?: string; url?: string }

/** A feed declaration with its schema and fields already parsed. */
export type ParsedFeed = {
  sourceId: string
  feed: {
    schema: DataSchema
    fields: DataField[]
    starterTriggers?: unknown[]
    retentionDays?: number
    maxEvents?: number
  }
}

/** The field the host adds to every record: when the event happened, as the plugin said. */
const TIME_FIELD: DataField = {
  pointer: '/time',
  label: 'Time',
  origin: 'declared',
  display: { kind: 'datetime', role: 'updated' },
  query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
}

/** The operators the shared evaluator can apply to every record's value of this type. A nullable value
 *  takes equality only, because an ordered comparison with null throws. */
function operatorsFor(schema: DataSchema): DataOperator[] {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const nullable = types.includes('null')
  const type = types.find((candidate) => candidate !== 'null')
  if (type === 'boolean') return ['eq', 'ne']
  if (type === 'string') return nullable ? ['eq', 'ne', 'in'] : ['eq', 'ne', 'in', 'contains']
  if (type === 'number' || type === 'integer')
    return nullable ? ['eq', 'ne', 'in'] : ['eq', 'ne', 'in', 'lt', 'lte', 'gt', 'gte']
  if (type === 'array' && !nullable) return ['contains']
  return []
}

// FNV-1a. The revision only has to change when the declaration does.
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193)
  return (value >>> 0).toString(36)
}

/** What `describe` answers for a feed, and what it keeps. The host decides which operators a field
 *  takes: a required top-level field gets every one its type allows, and any other gets none, because
 *  a comparison with a missing value throws. */
export function feedDescription({ sourceId, feed }: ParsedFeed): {
  description: DataSourceDescription
  retentionDays: number
  maxEvents: number
} {
  const own = feed.schema
  if (own.type !== 'object' || !own.properties) throw new Error(`The ${sourceId} feed's schema must be an object`)
  if (Object.hasOwn(own.properties, 'time'))
    throw new Error(`The ${sourceId} feed's schema can't declare time: acorn adds it to every event`)
  const schema: DataSchema = {
    ...own,
    properties: { ...own.properties, time: { type: 'integer' } },
    required: [...(own.required ?? []), 'time'],
  }
  const fields = feed.fields.map((field): DataField => {
    const name = /^\/([^/]+)$/.exec(field.pointer)?.[1]?.replaceAll('~1', '/').replaceAll('~0', '~')
    const property = name !== undefined && own.required?.includes(name) ? own.properties![name] : undefined
    const { query: _query, ...rest } = field
    const operators = field.origin === 'observed' || !property ? [] : operatorsFor(property)
    return operators.length ? { ...rest, query: { operators, sortable: operators.includes('lt') } } : rest
  })
  const retentionDays = feed.retentionDays ?? DATA_FEED_LIMITS.retentionDays
  const maxEvents = feed.maxEvents ?? DATA_FEED_LIMITS.maxEvents
  const kept = `the last ${retentionDays} days, up to ${maxEvents.toLocaleString('en-US')} events`
  const description: DataSourceDescription = {
    schema,
    fields: [...fields, TIME_FIELD],
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: true, groups: ['all', 'any'] },
    incremental: {
      semantics: 'Continues after the newest event the last read returned, in the order they were stored.',
    },
    revision: `feed.${hash(JSON.stringify([schema, fields]))}`,
    consistency: `Events the plugin appended, newest first. Acorn keeps ${kept}.`,
    coverage: { kind: 'events', retention: kept[0]!.toUpperCase() + kept.slice(1), complete: true },
    ...(feed.starterTriggers
      ? { starterTriggers: feed.starterTriggers as DataSourceDescription['starterTriggers'] }
      : {}),
  }
  return { description, retentionDays, maxEvents }
}
