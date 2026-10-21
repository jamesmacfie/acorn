import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import type { StarterTrigger } from '@acorn/protocol/starterTriggers.ts'

export const errorSource: DataSourceRegistration = {
  sourceId: 'error-groups',
  name: 'Rollbar error groups',
  singular: 'Error group',
  plural: 'Error groups',
  providerId: 'rollbar',
  identityScope: 'System item ID and immutable project counter, scoped to one project connection',
  handler: '/v1/p/rollbar/data/errors',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:rollbar',
}
const recordSchema: DataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    counter: { type: 'string' },
    title: { type: 'string' },
    url: { type: ['string', 'null'] },
    level: { type: 'string' },
    status: { type: 'string' },
    environment: { type: 'string' },
    totalOccurrences: { type: 'number' },
    firstOccurrenceAt: { type: ['number', 'null'] },
    lastOccurrenceAt: { type: ['number', 'null'] },
  },
  required: [
    'id',
    'counter',
    'title',
    'url',
    'level',
    'status',
    'environment',
    'totalOccurrences',
    'firstOccurrenceAt',
    'lastOccurrenceAt',
  ],
}
const nullableText: DataSchema = { type: ['string', 'null'] }
const nullableNumber: DataSchema = { type: ['number', 'null'] }
export const errorDetailSchema: DataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    group: recordSchema,
    latestOccurrence: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        occurredAt: nullableNumber,
        message: nullableText,
        exceptionClass: nullableText,
        frames: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              filename: { type: 'string' },
              line: nullableNumber,
              column: nullableNumber,
              method: nullableText,
              code: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { line: { type: 'number' }, text: { type: 'string' } },
                  required: ['line', 'text'],
                },
              },
              inProject: { type: ['boolean', 'null'] },
            },
            required: ['filename', 'line', 'column', 'method', 'code', 'inProject'],
          },
        },
      },
      required: ['id', 'occurredAt', 'message', 'exceptionClass', 'frames'],
    },
  },
  required: ['group', 'latestOccurrence'],
}

// Suggested triggers (docs/plugin-authoring/triggers.md). Rollbar has no moment to say its errors
// changed, so these check on the trigger's cadence. The 2 is a starting value the person edits.
const fieldIs = (pointer: string, operator: 'eq' | 'gte', value: string | number) => ({
  kind: 'comparison' as const,
  left: { address: { from: 'item' as const, pointer } },
  operator,
  right: { address: { from: 'literal' as const, value } },
})
const active = fieldIs('/status', 'eq', 'active')
const errorStarterTriggers: StarterTrigger[] = [
  {
    id: 'seen-again',
    label: 'An error seen more than once',
    description:
      'Starts a run when an active error reaches two occurrences, and again if it comes back after it’s resolved.',
    predicate: { kind: 'all', predicates: [fieldIs('/totalOccurrences', 'gte', 2), active] },
    change: { on: 'enters' },
  },
  {
    id: 'new-error',
    label: 'A new error',
    description: 'Starts a run once for each new active error.',
    predicate: active,
    change: { on: 'new' },
  },
]

export const errorSourceDescription: DataSourceDescription = {
  revision: '2',
  schema: recordSchema,
  detailSchema: errorDetailSchema,
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/counter', label: 'Counter', origin: 'declared' },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    ...(['level', 'status', 'environment'] as const).map((key) => ({
      pointer: `/${key}`,
      label: key === 'level' ? 'Level' : key === 'status' ? 'Status' : 'Environment',
      origin: 'declared' as const,
      query: { operators: ['eq'] as 'eq'[], sortable: false },
    })),
    {
      pointer: '/totalOccurrences',
      label: 'Occurrences',
      origin: 'declared',
      display: { kind: 'number' },
      query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: false },
    },
    ...(['firstOccurrenceAt', 'lastOccurrenceAt'] as const).map((key) => ({
      pointer: `/${key}`,
      label: key === 'firstOccurrenceAt' ? 'First seen' : 'Last seen',
      origin: 'declared' as const,
      display: { kind: 'datetime' as const },
      query: { operators: ['gt', 'gte', 'lt', 'lte'] as ('gt' | 'gte' | 'lt' | 'lte')[], sortable: true },
    })),
  ],
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  parameterFields: [],
  operations: { query: true, options: false, details: true, incremental: false, groups: ['all'] },
  starterTriggers: errorStarterTriggers,
  consistency:
    'One Rollbar project connection. REST status, level and environment filters narrow candidates; occurrence count and first/last seen predicates are applied after exhausting at most 5,000 items. Larger sets are incomplete, including sorted take. No upstream snapshot isolation or incremental checkpoint guarantee. Continuations retain selections for 60 seconds. Details use the existing safe occurrence projection; truncated projections fail explicitly.',
}
