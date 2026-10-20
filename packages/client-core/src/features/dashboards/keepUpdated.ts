import type { PanelPlan, SuppliedRows } from '@acorn/protocol/dashboards.ts'
import type { DatasetMode, DatasetRefresh } from '@acorn/protocol/datasets.ts'
import { MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'

// Turning a panel over supplied rows into a panel over a dataset an agent keeps up to date
// (docs/dashboards/supplied-rows.md § Keeping it up to date). The rows, schema, and fields copy across;
// these add what an agent-fed dataset needs and suggest how it stores rows.

/** What an agent-fed dataset adds to every row, so a supplied field can't share one of the names. */
const ADDED_FIELDS = ['evidence', 'reason', 'correction', '_observationTime', '_arrivedAt']

const valuesAt = (reference: SuppliedRows, pointer: string): DataValue[] =>
  reference.rows.flatMap((row) => {
    const value = readDataPointer(row, pointer)
    return value === MISSING || value === null ? [] : [value]
  })

const instant = (value: DataValue): number =>
  typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN

const isDate = (value: DataValue): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)

/** Why the rows can't be kept, or nothing. */
export function keepProblem(reference: SuppliedRows): string | undefined {
  if (!reference.rows.length) return 'There are no rows to keep.'
  const clash = ADDED_FIELDS.find((name) => reference.schema.properties?.[name])
  return clash ? `A field named ${clash} clashes with what a dataset stores for each row.` : undefined
}

/** The fields that hold a time: declared as one, or a date in every row that has a value. */
export function timeFields(reference: SuppliedRows): string[] {
  return reference.fields
    .filter((field) => {
      const values = valuesAt(reference, field.pointer)
      return field.display?.kind === 'datetime' || (values.length > 0 && values.every(isDate))
    })
    .map((field) => field.pointer)
}

/** A table with a time ahead of when the agent read it, such as a forecast, is replaced each time. Past
 *  times are rows that each happened once, such as releases. Numbers with no time are tracked by day. */
export function suggestMode(reference: SuppliedRows): { mode: DatasetMode; eventTimeField?: string } {
  const times = timeFields(reference)
  if (times.some((pointer) => valuesAt(reference, pointer).some((value) => instant(value) > reference.origin.readAt)))
    return { mode: 'current-mirror' }
  if (times[0]) return { mode: 'event-archive', eventTimeField: times[0] }
  const counts = reference.fields.some((field) =>
    valuesAt(reference, field.pointer).some((value) => typeof value === 'number'),
  )
  return { mode: counts ? 'snapshot-history' : 'current-mirror' }
}

/** Why these fields can't tell the rows apart, or nothing. A dataset keeps one row per identity. */
export function identityProblem(rows: readonly DataValue[], pointers: readonly string[]): string | undefined {
  if (!pointers.length) return 'Choose at least one field that tells the rows apart.'
  const seen = new Set<string>()
  for (const row of rows) {
    const values = pointers.map((pointer) => readDataPointer(row, pointer))
    if (values.some((value) => value === MISSING || value === null || typeof value === 'object'))
      return 'Every row needs a value in each of these fields.'
    const key = JSON.stringify(values)
    if (seen.has(key)) return 'Two rows share these values, so one would replace the other.'
    seen.add(key)
  }
  return undefined
}

/** The fewest fields that tell every row apart, trying words and dates before numbers, since a count
 *  that happens to differ on every row is no name for one. */
export function suggestIdentity(reference: SuppliedRows): string[] {
  const numeric = (pointer: string) => valuesAt(reference, pointer).some((value) => typeof value === 'number')
  const pointers = reference.fields.map((field) => field.pointer)
  const ordered = [...pointers.filter((pointer) => !numeric(pointer)), ...pointers.filter(numeric)]
  const unique = (candidate: string[]) => !identityProblem(reference.rows, candidate)
  for (const pointer of ordered) if (unique([pointer])) return [pointer]
  for (const [index, first] of ordered.entries())
    for (const second of ordered.slice(index + 1)) if (unique([first, second])) return [first, second]
  return ordered.slice(0, 8)
}

/** The body that creates the dataset with the snapshot's rows as its first write, each with the origin
 *  as its evidence. It is a workspace dataset, so a Home tab can draw it, and the task's project
 *  refreshes it. */
export function keptDatasetInput(
  reference: SuppliedRows,
  choices: {
    name: string
    workspaceId: string
    mode: DatasetMode
    identityFields: string[]
    eventTimeField?: string
    refresh: Omit<DatasetRefresh, 'origin'>
  },
) {
  const { says, urls } = reference.origin
  return {
    name: choices.name,
    workspaceId: choices.workspaceId,
    mode: choices.mode,
    feeder: 'agent' as const,
    schema: {
      ...reference.schema,
      properties: {
        ...reference.schema.properties,
        evidence: { type: 'object' },
        reason: { type: 'string' },
        correction: { type: ['string', 'null'] },
      },
    },
    fields: [...reference.fields, { pointer: '/correction', label: 'Correction', origin: 'declared' as const }],
    identityFields: choices.identityFields,
    ...(choices.mode === 'event-archive'
      ? { eventTimeField: choices.eventTimeField, backfillFrom: reference.origin.readAt }
      : {}),
    refresh: { ...choices.refresh, origin: { says, ...(urls ? { urls } : {}) } },
    rows: reference.rows.map((data) => ({
      data,
      evidence: reference.origin,
      reason: "The agent's snapshot, kept when the panel was added to a dashboard.",
    })),
  }
}

/** The same plan, reading the dataset in place of its rows. Its stages and view don't change. */
export function keptPlan(plan: PanelPlan, datasetId: string, workspaceId: string): PanelPlan {
  const [source, ...rest] = plan.sources
  return {
    ...plan,
    sources: [
      {
        ...source!,
        reference: {
          kind: 'inline',
          content: {
            name: plan.title.slice(0, 80),
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            query: {
              source: { pluginId: 'core', sourceId: `dataset:${datasetId}` },
              scope: { workspaceId, parameters: {} },
              sort: [],
            },
            sourceParameters: {},
          },
          bindings: {},
        },
      },
      ...rest,
    ],
  }
}

/** What an agent is asked, on request or on a schedule, to refresh a kept panel's dataset. */
export function refreshPrompt(datasetId: string, name: string, origin: DatasetRefresh['origin']): string {
  const urls = origin.urls?.length ? ` (${origin.urls.join(', ')})` : ''
  return [
    `Refresh the dataset "${name}", which keeps a dashboard panel up to date. Its rows first came from ${origin.says}${urls}.`,
    `1. Call data_source_describe with pluginId "core" and sourceId "dataset:${datasetId}" for its fields. Its revision is the dataset's version.`,
    '2. Gather fresh rows for those fields from the same place.',
    `3. Write them with dataset_write: datasetId "${datasetId}", that version, and for each row its data, evidence as an object naming where you read it, such as { "says": "...", "urls": ["https://..."] }, and a short reason.`,
    "Don't draw a panel. The dashboard panel reads the dataset.",
  ].join('\n')
}
