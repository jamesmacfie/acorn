// The records kind: a trigger that starts one run for each record its query returns that's new,
// starts matching, or changes (docs/workflows/triggers.md § Record triggers). A check that finds
// nothing creates nothing. Loaded on a trigger's first check, approval, or preview, to keep it off the
// Node's boot graph.
import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, gt, inArray, notInArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { ScheduleSkipped } from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { QueryReference, ResolvedQuery } from '@acorn/protocol/dataQueries.ts'
import { readDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import type { DataRecord, DataSourceQuery, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { MISSING, type DataValue } from '@acorn/protocol/dataValues.ts'
import {
  recordChangeDecision,
  recordIdentity,
  recordProjection,
  type RecordChangeDecision,
  type RecordChangePolicy,
} from '@acorn/protocol/recordChanges.ts'
import { prefillFromItem, RECORD_FILLED_INPUTS } from '../../contract/itemInputs.ts'
import * as schema from '../../node/schema'
import type { ResolvedWorkflowGraph, WorkflowAuthorityReason } from '../../shared/workflowContracts'
import type {
  WorkflowRecordChange,
  WorkflowRecordsWhen,
  WorkflowTriggerCheck,
  WorkflowTriggerMatch,
  WorkflowTriggerPreparation,
  WorkflowTriggerPreview,
} from '../../shared/workflowTriggers'
import { BUILTIN_AGENT_STEP_KINDS } from '../../shared/stepFields'
import { workflowContentFingerprint } from '../definitions/fingerprint'
import type { WorkflowTransaction } from '../dispatch/dispatcher'
import { asAuthorityError, WorkflowAuthorityError } from '../runs/authority'
import { resolveWorkflowInputs } from '../validation/definition'
import { prefixedFields, recordSchema, type TriggerSourceDescription } from './clock'
import { ACTIVE_OCCURRENCE, type Occurrence, type Trigger, type TriggerOccurrences } from './occurrences'

const DAY_MS = 24 * 60 * 60 * 1000
export const DEFAULT_RUNS_PER_CHECK = 10
export const DEFAULT_RUNS_PER_DAY = 50
const PREVIEW_RECORDS = 20
const MATCH_HISTORY = 50

/** Reads a record trigger's source in its project's scope, as the workflow's owner. */
export type TriggerRecordReader = {
  describe(projectId: string, reference: QueryReference): Promise<TriggerSourceDescription>
  resolve(projectId: string, reference: QueryReference, evaluationTime: number): Promise<ResolvedQuery>
  /** `execution` reads every page. `preview` reads the first. */
  read(
    projectId: string,
    query: DataSourceQuery,
    evaluationTime: number,
    mode: 'execution' | 'preview',
  ): Promise<DataSourceResult>
  /** Lists the trigger among a saved query's consumers, or removes it. `href` opens its workflow. */
  consume(
    projectId: string,
    queryId: string,
    consumer: { id: string; name: string; href: string },
    remove: boolean,
  ): Promise<void>
}

/** What approval pins: the query as it'll be read, and the source it reads, for hearing changes. */
export type ApprovedRecordQuery = { query: QueryReference; source: { pluginId: string; sourceId: string } }

export type RecordTriggerDeps = {
  db: PluginDatabase
  reader: TriggerRecordReader
  occurrences: Pick<TriggerOccurrences, 'reserveIn' | 'resume'>
  moveToReview(id: string, error: string, reason?: WorkflowAuthorityReason): void
}

type Envelope = Pick<DataRecord, 'ref' | 'data' | 'display'>
type LedgerRow = typeof schema.workflowTriggerRecords.$inferSelect

const policyOf = (change: WorkflowRecordChange): RecordChangePolicy =>
  change.on === 'new'
    ? { mode: 'unseen' }
    : change.on === 'enters'
      ? { mode: 'enters' }
      : { mode: 'changed', fields: change.fields }

const envelopeOf = (record: DataRecord): Envelope => ({
  ref: record.ref,
  data: record.data,
  ...(record.display ? { display: record.display } : {}),
})

const titleOf = (record: Envelope): string => record.display?.title?.trim() || record.ref.recordId

/** The fields a kept projection covers, read back from its canonical encoding. */
const keptFields = (projection: string): string[] =>
  (JSON.parse(projection) as Array<[string, unknown]>).map(([pointer]) => pointer)

const previousOf = (row: LedgerRow | undefined) =>
  row ? { fields: keptFields(row.projection), projection: row.projection, matching: row.matching } : undefined

/** The source's own reason a read stopped short, in words. */
function partialReason(completeness: DataSourceResult['completeness']): string | undefined {
  if (completeness.kind === 'complete') return undefined
  if (completeness.kind === 'bounded') return 'The query stops at its record limit.'
  if (completeness.kind === 'more') return 'The read stopped before the last page.'
  return {
    'upstream-cap': 'The source caps how many matches it returns.',
    'provider-failure': 'The source failed partway through.',
    'host-budget': "The read reached Acorn's limit on records or bytes.",
    'coverage-gap': "The source's history has a gap.",
    'invalid-records': "Some records didn't fit the source's fields.",
  }[completeness.cause]
}

/** The inputs a record trigger fills from each record: the ones it binds, and the ones the item rule
 *  names that the owner gave no value. The trigger's bindings come first. */
export function recordFilledInputs(when: WorkflowRecordsWhen, inputs: Record<string, DataValue>): string[] {
  const bound = Object.keys(when.bindings ?? {})
  return [...bound, ...RECORD_FILLED_INPUTS.filter((name) => !bound.includes(name) && !Object.hasOwn(inputs, name))]
}

/** The checks a record trigger must pass before approval, which review shows too. Returns the
 *  source's description. */
export async function reviewRecords(
  reader: TriggerRecordReader,
  row: Pick<Trigger, 'projectId'>,
  when: WorkflowRecordsWhen,
  graph: ResolvedWorkflowGraph,
): Promise<TriggerSourceDescription> {
  const source = await reader.describe(row.projectId, when.query)
  const pointers = new Set(prefixedFields(source.fields).map((field) => field.pointer))
  if (when.change.on === 'changes') {
    if (!when.change.fields.length) throw new Error('Choose at least one field whose change starts a run.')
    const unknown = when.change.fields.find((field) => !pointers.has(field))
    if (unknown) throw new WorkflowAuthorityError('missing', `${source.label} doesn't describe the field ${unknown}.`)
  }
  if (when.incremental && when.change.on === 'enters')
    throw new Error('Starts matching needs a complete read every check, so it cannot continue from a checkpoint.')
  if (when.incremental && !source.incremental)
    throw new Error(source.incrementalReason ?? `${source.label} can't continue from a checkpoint.`)
  const declared = new Set((graph.root.inputs ?? []).map((input) => input.name))
  for (const [name, binding] of Object.entries(when.bindings ?? {})) {
    if (!declared.has(name)) throw new Error(`${graph.root.name} has no input named ${name}.`)
    if (binding.address.from !== 'item') throw new Error(`The input ${name} can only be bound to a record field.`)
  }
  return source
}

/** Whether a trigger on core's Tasks source could match a task an agent made: the query doesn't hold
 *  `createdByTask` to missing. Core's Tasks source combines conditions with "all" only. */
export async function matchesAgentTasks(
  reader: TriggerRecordReader,
  projectId: string,
  when: WorkflowRecordsWhen,
): Promise<boolean> {
  const { query } = await reader.resolve(projectId, when.query, Date.now())
  if (query.source.pluginId !== 'core' || query.source.sourceId !== 'tasks') return false
  const excludes = (predicate?: DataPredicate): boolean =>
    predicate?.kind === 'all'
      ? predicate.predicates.some(excludes)
      : predicate?.kind === 'comparison' &&
        predicate.operator === 'missing' &&
        predicate.left.address.from === 'item' &&
        predicate.left.address.pointer === '/createdByTask'
  return !excludes(query.predicate)
}

/** What the approval sheet says about agent steps, which read text the people who write records chose. Set
 *  when the workflow has one. shortcut: built-in kinds only, so a contributed agent kind gets no
 *  warning here, but the agents plugin still refuses it at run time. */
export function recordAgents(
  source: TriggerSourceDescription,
  graph: ResolvedWorkflowGraph,
): { recordAgents?: WorkflowTriggerPreparation['recordAgents'] } {
  const runsAgent = graph.nodes.some((node) =>
    node.definition.steps.some((step) => BUILTIN_AGENT_STEP_KINDS.has(step.kind ?? 'agent')),
  )
  return runsAgent ? { recordAgents: source.recordsFrom ? { from: source.recordsFrom } : {} } : {}
}

/** Approval's part for a record trigger: the review checks, then the query pinned at the saved
 *  revision it resolves to now, with the trigger listed among that query's consumers. A changed
 *  field list can't be compared with what the ledger kept, so it needs Start fresh. */
export async function approveRecords(
  deps: RecordTriggerDeps,
  row: Trigger,
  when: WorkflowRecordsWhen,
  graph: ResolvedWorkflowGraph,
  freshEpoch: boolean,
): Promise<ApprovedRecordQuery> {
  await reviewRecords(deps.reader, row, when, graph)
  const fields = when.change.on === 'changes' ? [...new Set(when.change.fields)].sort() : []
  const kept = freshEpoch
    ? undefined
    : deps.db
        .select()
        .from(schema.workflowTriggerRecords)
        .where(
          and(eq(schema.workflowTriggerRecords.triggerId, row.id), eq(schema.workflowTriggerRecords.epoch, row.epoch)),
        )
        .get()
  if (kept && JSON.stringify(keptFields(kept.projection)) !== JSON.stringify(fields))
    throw new Error(
      'The fields this trigger compares changed. Choose Start fresh to compare records on the new fields.',
    )
  const resolved = await deps.reader.resolve(row.projectId, when.query, Date.now())
  const query =
    when.query.kind === 'saved'
      ? { ...when.query, revision: resolved.published?.revision ?? when.query.revision }
      : when.query
  if (query.kind === 'saved')
    await deps.reader.consume(row.projectId, query.queryId, triggerConsumer(row, graph.root.name), false)
  return { query, source: { pluginId: resolved.query.source.pluginId, sourceId: resolved.query.source.sourceId } }
}

/** How a saved query lists the trigger that reads it. */
const triggerConsumer = (row: Pick<Trigger, 'id' | 'workflowId'>, workflowName: string) => ({
  id: row.id,
  name: `${workflowName} trigger`,
  href: `/workflows/db:${row.workflowId}`,
})

/** Takes a deleted trigger off its saved query's list of consumers. Removal matches on the ID. */
export async function releaseQuery(reader: TriggerRecordReader, row: Trigger): Promise<void> {
  const { query } = JSON.parse(row.approvedQueryJson!) as ApprovedRecordQuery
  if (query.kind === 'saved') await reader.consume(row.projectId, query.queryId, triggerConsumer(row, ''), true)
}

/** A record's inputs: the item rule for the names it covers, then the owner's values, then the
 *  trigger's own bindings. Returns the reason, naming the input, when they don't fit the workflow. */
function recordInputs(
  graph: ResolvedWorkflowGraph,
  literals: Record<string, DataValue>,
  bindings: WorkflowRecordsWhen['bindings'],
  record: Envelope,
): { inputs: Record<string, DataValue> } | { problem: string } {
  const declared = new Set((graph.root.inputs ?? []).map((input) => input.name))
  const filled = Object.entries(prefillFromItem({ record })).filter(([name]) => declared.has(name))
  const bound = Object.entries(bindings ?? {}).flatMap(([name, binding]) => {
    const value = readDataBinding(binding, { item: record as unknown as DataValue })
    return value === MISSING ? [] : [[name, value] as const]
  })
  const inputs = { ...Object.fromEntries(filled), ...literals, ...Object.fromEntries(bound) }
  try {
    resolveWorkflowInputs(graph.root, inputs)
    return { inputs }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}

/** Work this trigger started, read back as a record: a run in a tree it started, through the Workflow
 *  runs source, or the task it made for a run, through core's Tasks source. A run's task is titled
 *  after its record, so it often matches the same filter. Admitting either would let a trigger feed
 *  on its own runs. */
function ownRun(db: PluginDatabase | WorkflowTransaction, triggerId: string, record: Envelope): boolean {
  const { pluginId, sourceId, recordId } = record.ref
  if (pluginId === 'core' && sourceId === 'tasks') {
    const occurrences = schema.workflowTriggerOccurrences
    return !!db
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.triggerId, triggerId), eq(occurrences.taskId, recordId)))
      .get()
  }
  if (pluginId !== 'workflows' || sourceId !== 'runs') return false
  const runs = schema.workflowRuns
  const run = db.select().from(runs).where(eq(runs.id, recordId)).get()
  const root =
    run?.rootRunId && run.rootRunId !== run.id ? db.select().from(runs).where(eq(runs.id, run.rootRunId)).get() : run
  return root?.triggerId === triggerId
}

/** Reads the pinned query at `at`, continuing from the trigger's checkpoint when it has one. A
 *  refusal only the owner can fix moves the trigger to review and skips this check. */
async function readRecords(
  deps: RecordTriggerDeps,
  row: Trigger,
  when: WorkflowRecordsWhen,
  at: number,
): Promise<{ result: DataSourceResult; fingerprint?: string }> {
  const approved = JSON.parse(row.approvedQueryJson!) as ApprovedRecordQuery
  try {
    const resolved = await deps.reader.resolve(row.projectId, approved.query, at)
    const { incremental: _incremental, ...base } = resolved.query
    if (!when.incremental)
      return { result: await deps.reader.read(row.projectId, base as DataSourceQuery, at, 'execution') }
    const fingerprint = workflowContentFingerprint(base)
    if (row.boundaryJson && row.queryFingerprint !== fingerprint)
      throw new WorkflowAuthorityError(
        'missing',
        'The query changed since its checkpoint. Choose Start fresh to read it again.',
      )
    const incremental = row.boundaryJson
      ? { kind: 'continue' as const, boundary: JSON.parse(row.boundaryJson) as DataValue }
      : { kind: 'baseline' as const }
    try {
      return { result: await deps.reader.read(row.projectId, { ...base, incremental }, at, 'execution'), fingerprint }
    } catch (error) {
      // A source refuses a checkpoint it can no longer continue from as an invalid request.
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (incremental.kind !== 'continue' || code !== 'invalid-request') throw error
      throw new WorkflowAuthorityError(
        'missing',
        `The source could not continue from the last checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  } catch (error) {
    const refusal = asAuthorityError(error)
    if (!(refusal instanceof WorkflowAuthorityError)) throw error
    deps.moveToReview(row.id, refusal.message, refusal.reason)
    throw new ScheduleSkipped(refusal.message)
  }
}

/**
 * One check. It reads every page, decides each record, and in one transaction updates the ledger and
 * reserves an occurrence for each admitted record up to the caps. A record over a cap stays undecided,
 * so the next check sees it again, and the checkpoint moves only when nothing was left over. After the
 * commit, each occurrence makes its task and starts its run. A baseline check, Track from now, writes
 * the ledger and starts nothing.
 */
export async function checkRecords(
  deps: RecordTriggerDeps,
  row: Trigger,
  options: { baseline: boolean },
): Promise<string | void> {
  const { db } = deps
  const when = JSON.parse(row.whenJson) as WorkflowRecordsWhen
  const at = Date.now()
  const { result, fingerprint } = await readRecords(deps, row, when, at)
  const partial = partialReason(result.completeness)
  // Only a complete read of every match can say which records stopped matching.
  const whole = !partial && !when.incremental
  const graph = JSON.parse(row.approvedGraphJson!) as ResolvedWorkflowGraph
  const literals = JSON.parse(row.inputsJson) as Record<string, DataValue>
  const policy = policyOf(when.change)
  const fields = when.change.on === 'changes' ? [...new Set(when.change.fields)].sort() : []
  const perCheck = when.runsPerCheck ?? DEFAULT_RUNS_PER_CHECK
  const perDay = when.runsPerDay ?? DEFAULT_RUNS_PER_DAY
  const ledger = schema.workflowTriggerRecords
  const occurrences = schema.workflowTriggerOccurrences
  const checkId = randomUUID()
  const reserved: Occurrence[] = []
  let leftOver = false
  let dailyCapped = false

  db.transaction((tx) => {
    let today = tx
      .select({ n: count() })
      .from(occurrences)
      .where(
        and(
          eq(occurrences.triggerId, row.id),
          eq(occurrences.generation, row.generation),
          eq(occurrences.kind, 'record'),
          gt(occurrences.createdAt, at - DAY_MS),
          notInArray(occurrences.state, ['blocked', 'skipped']),
        ),
      )
      .get()!.n
    let started = 0
    const seen: string[] = []
    for (const found of result.records) {
      const record = envelopeOf(found)
      const recordKey = recordIdentity(record)
      if (!recordKey || seen.includes(recordKey) || ownRun(tx, row.id, record)) continue
      seen.push(recordKey)
      const key = and(eq(ledger.triggerId, row.id), eq(ledger.epoch, row.epoch), eq(ledger.recordKey, recordKey))
      const kept = tx.select().from(ledger).where(key).get()
      // Overlap is per record: one whose run is still going starts nothing, whichever epoch started it.
      const active = tx
        .select({ id: occurrences.id })
        .from(occurrences)
        .where(
          and(
            eq(occurrences.triggerId, row.id),
            eq(occurrences.recordKey, recordKey),
            inArray(occurrences.state, [...ACTIVE_OCCURRENCE]),
          ),
        )
        .get()
      const decision: RecordChangeDecision = recordChangeDecision({
        policy,
        snapshot: record as unknown as DataValue,
        previous: previousOf(kept),
        active: !!active,
        baseline: options.baseline,
      })
      let occurrenceId = kept?.lastOccurrenceId ?? null
      if (decision === 'admitted') {
        if (started >= perCheck || today >= perDay) {
          leftOver = true
          dailyCapped ||= today >= perDay
          continue
        }
        const filled = recordInputs(graph, literals, when.bindings, record)
        const occurrence = deps.occurrences.reserveIn(tx, row, {
          kind: 'record',
          requestKey: `record:${checkId}:${recordKey}`,
          recordKey,
          record: { title: titleOf(record), reason: when.change.on },
          ...('inputs' in filled
            ? { inputs: filled.inputs }
            : { inputs: literals, blocked: `${titleOf(record)}: ${filled.problem}` }),
        })
        occurrenceId = occurrence.id
        if (occurrence.state === 'claimed') {
          reserved.push(occurrence)
          started++
          today++
        }
      }
      // An active record keeps its projection, so a change made while its run works is seen after.
      const projection =
        decision === 'admitted' || decision === 'baseline' || !kept ? recordProjection(record, fields) : kept.projection
      const values = { projection, matching: true, lastSeenAt: at, lastOccurrenceId: occurrenceId }
      tx.insert(ledger)
        .values({ triggerId: row.id, epoch: row.epoch, recordKey, firstSeenAt: at, ...values })
        .onConflictDoUpdate({ target: [ledger.triggerId, ledger.epoch, ledger.recordKey], set: values })
        .run()
    }
    if (whole)
      tx.update(ledger)
        .set({ matching: false })
        .where(
          and(
            eq(ledger.triggerId, row.id),
            eq(ledger.epoch, row.epoch),
            eq(ledger.matching, true),
            notInArray(ledger.recordKey, seen),
          ),
        )
        .run()
    const check: WorkflowTriggerCheck = { at, started, ...(partial ? { partial } : {}) }
    tx.update(schema.workflowTriggers)
      .set({
        lastCheckJson: JSON.stringify(check),
        ...(fingerprint && result.incrementalBoundary !== undefined && !leftOver
          ? { boundaryJson: JSON.stringify(result.incrementalBoundary), queryFingerprint: fingerprint }
          : {}),
      })
      .where(and(eq(schema.workflowTriggers.id, row.id), eq(schema.workflowTriggers.generation, row.generation)))
      .run()
  })

  let started = 0
  for (const occurrence of reserved) {
    // A failure that needs the owner has already moved the trigger to review. Any other leaves the
    // occurrence claimed, and the next check's reconcile resumes it.
    const resumed = await deps.occurrences.resume(occurrence).catch(() => undefined)
    if (resumed?.state === 'run-started') started++
  }
  // After this check's runs start, because review blocks an occurrence that hasn't.
  if (dailyCapped) deps.moveToReview(row.id, `Started ${perDay} runs today. Review the trigger before it starts more.`)
  if (started) return `started ${started} workflow ${started === 1 ? 'run' : 'runs'}`
}

/** Track from now, run in place by approval: the ledger learns today's matches and nothing starts.
 *  The trigger becomes active when that commits, and `baseline-failed` if it can't. */
export async function baselineRecords(deps: RecordTriggerDeps, row: Trigger): Promise<void> {
  const triggers = schema.workflowTriggers
  const current = and(eq(triggers.id, row.id), eq(triggers.generation, row.generation))
  try {
    await checkRecords(deps, row, { baseline: true })
    deps.db.update(triggers).set({ state: 'active', updatedAt: Date.now() }).where(current).run()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Baseline check failed.'
    if (deps.db.select().from(triggers).where(eq(triggers.id, row.id)).get()?.state !== 'needs-review')
      deps.db
        .update(triggers)
        .set({ state: 'baseline-failed', error: message, errorReason: null, updatedAt: Date.now() })
        .where(current)
        .run()
    throw error
  }
}

/** What the query returns now, up to 20 records, and whether Process current matches would start a
 *  run for each. Track from now starts none. */
export async function previewRecords(
  deps: Pick<RecordTriggerDeps, 'db' | 'reader'>,
  draft: { projectId: string; when: WorkflowRecordsWhen },
  row?: Trigger,
): Promise<WorkflowTriggerPreview> {
  const at = Date.now()
  const source = await deps.reader.describe(draft.projectId, draft.when.query)
  const resolved = await deps.reader.resolve(draft.projectId, draft.when.query, at)
  const { incremental: _incremental, ...query } = resolved.query
  const result = await deps.reader.read(draft.projectId, query as DataSourceQuery, at, 'preview')
  const policy = policyOf(draft.when.change)
  const ledger = schema.workflowTriggerRecords
  const records = result.records.slice(0, PREVIEW_RECORDS).map((found) => {
    const record = envelopeOf(found)
    const recordKey = recordIdentity(record)
    const kept =
      row && recordKey
        ? deps.db
            .select()
            .from(ledger)
            .where(and(eq(ledger.triggerId, row.id), eq(ledger.epoch, row.epoch), eq(ledger.recordKey, recordKey)))
            .get()
        : undefined
    let wouldStart = false
    try {
      const snapshot = record as unknown as DataValue
      wouldStart =
        !(row && ownRun(deps.db, row.id, record)) &&
        recordChangeDecision({ policy, snapshot, previous: previousOf(kept), active: false }) === 'admitted'
    } catch {
      // A changes rule with no fields chosen yet starts nothing.
    }
    return { title: titleOf(record), ...(record.display?.url ? { link: record.display.url } : {}), wouldStart }
  })
  const partial = result.completeness.kind === 'more' ? undefined : partialReason(result.completeness)
  return {
    source: {
      label: source.label,
      schema: recordSchema(source.schema),
      fields: prefixedFields(source.fields),
      incremental: source.incremental,
      ...(source.incrementalReason ? { incrementalReason: source.incrementalReason } : {}),
    },
    records,
    ...(partial ? { partial } : {}),
  }
}

/** A record trigger's last 50 matches, newest first, with each run's status. */
export function recordMatches(db: PluginDatabase, triggerId: string): WorkflowTriggerMatch[] {
  const occurrences = schema.workflowTriggerOccurrences
  const rows = db
    .select()
    .from(occurrences)
    .where(and(eq(occurrences.triggerId, triggerId), eq(occurrences.kind, 'record')))
    .orderBy(desc(occurrences.createdAt))
    .limit(MATCH_HISTORY)
    .all()
  const runIds = rows.map((row) => row.runId)
  const statuses = new Map(
    runIds.length
      ? db
          .select({ id: schema.workflowRuns.id, status: schema.workflowRuns.status })
          .from(schema.workflowRuns)
          .where(inArray(schema.workflowRuns.id, runIds))
          .all()
          .map((run) => [run.id, run.status])
      : [],
  )
  return rows.map((row) => {
    const record = (JSON.parse(row.payloadJson) as { record?: { title: string; reason: WorkflowRecordChange['on'] } })
      .record
    const status = statuses.get(row.runId)
    return {
      title: record?.title ?? 'Record',
      reason: record?.reason ?? 'new',
      state: ACTIVE_OCCURRENCE.includes(row.state as (typeof ACTIVE_OCCURRENCE)[number])
        ? 'active'
        : row.state === 'terminal'
          ? 'completed'
          : row.state === 'skipped'
            ? 'skipped'
            : 'blocked',
      taskId: row.taskId,
      runId: row.runId,
      ...(status ? { runStatus: status } : {}),
      ...(row.detail ? { detail: row.detail } : {}),
      createdAt: row.createdAt,
    }
  })
}
