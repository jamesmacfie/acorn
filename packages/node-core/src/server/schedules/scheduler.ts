import { randomUUID } from 'node:crypto'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import type { ToolRisk } from '@acorn/protocol/api.ts'
import {
  CADENCE_MIN_SECONDS,
  CADENCE_MIN_SECONDS_PLUGIN,
  type Cadence,
  cadencePeriodMs,
  clampCadence,
  parseCadence,
  type ScheduleRow,
  type ScheduleRun,
  type ScheduleStatus,
} from '@acorn/protocol/schedules.ts'
import { BridgeError } from '../bridge'
import { type AppDatabase, schema } from '../db'
import { nextRunAt } from './cadence'

// The node's one scheduler (docs/schedules.md). A schedule is a promise to run when nobody is looking,
// so it lives in the long-lived process — never in a client, which closes, hides and sleeps.
//
// Everything below is one class on purpose: the registry, the store and the loop are the same fact
// (what runs next, and what happened last time), and splitting them would mean three files passing the
// same three tables between each other. The pure arithmetic that CAN be separated already is
// (./cadence.ts).

/** What a runner is handed and what it gives back: an abort signal it is expected to honour, and one
 *  line for the run row. The same signal shape collection fetches already take. */
export type ScheduleRunner = (signal: AbortSignal) => Promise<string | void>

/** A schedule declared in code (core) or by a plugin. Registry-truth: this object IS the definition,
 *  and the database stores only the owner's overrides and the run state. */
export type DeclaredSchedule = {
  /** 'core:<id>' or '<pluginId>:<scheduleId>'. */
  key: string
  name: string
  cadence: Cadence
  /** The declared default. The owner's pause/resume overrides it and outlives a reload. */
  enabled?: boolean
  /** Default 60s, capped at 300s. Past that a scheduled job is a service. */
  timeoutMs?: number
  run: ScheduleRunner
}

/** What a USER schedule may do. Phase 1 registers none, which is why an unknown kind has to render
 *  inert rather than fail: the row is created by a later version of this node and read by this one. */
export type ScheduleTarget = {
  kind: string
  /** The tier stamped onto the row at creation — the consent record, taken once. */
  risk?: ToolRisk
  /** Validate a proposed target. `null` refuses the CREATE, which is the one non-tolerant edge here. */
  parse(target: unknown): unknown | null
  run(target: unknown, signal: AbortSignal): Promise<string | void>
}

export type Clock = {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  random(): number
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms)
    // The scheduler must never be the reason a node stays alive: teardown stops it explicitly, and an
    // un-unref'd timer would hold the event loop open for up to a week.
    handle.unref?.()
    return handle
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  random: Math.random,
}

/** The node also serves interactive traffic; scheduled work queues behind this in nextRunAt order and
 *  never starves a person's request. */
const CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000
/** Recent runs kept per schedule. Twenty is enough to see a pattern and small enough to never need a vacuum. */
const RUN_RING = 20
/** The reserved state key holding the global pause switch (server/db/schema.ts). */
const PAUSE_KEY = '*'

type Owner = { owner: 'core' | 'user' } | { owner: 'plugin'; pluginId: string }

/** Which of the three parties declared a key. The format is the whole mechanism — one registry, one
 *  settings list, and an owner badge that needs no extra column. */
export function keyOwner(key: string): Owner {
  const separator = key.indexOf(':')
  if (separator < 0) return { owner: 'core' }
  const head = key.slice(0, separator)
  if (head === 'core') return { owner: 'core' }
  if (head === 'user') return { owner: 'user' }
  return { owner: 'plugin', pluginId: head }
}

/** A plugin's floor is higher than core's and the owner's: its work spends someone else's rate budget. */
const floorFor = (key: string): number =>
  keyOwner(key).owner === 'plugin' ? CADENCE_MIN_SECONDS_PLUGIN : CADENCE_MIN_SECONDS

type StateRow = typeof schema.scheduleState.$inferSelect

type Entry = {
  key: string
  name: string
  kind: string
  cadence: Cadence
  declaredCadence: Cadence
  enabled: boolean
  registered: boolean
  timeoutMs: number
  risk?: ToolRisk
  state: StateRow
  run?: ScheduleRunner
}

export type CreateScheduleInput = { name: string; kind: string; target: unknown; cadence: Cadence }
export type PatchScheduleInput = { enabled?: boolean; cadence?: Cadence; name?: string }

export class Scheduler {
  readonly #db: AppDatabase
  readonly #clock: Clock
  readonly #declared = new Map<string, DeclaredSchedule>()
  readonly #targets = new Map<string, ScheduleTarget>()
  /** Serialization per schedule: a run whose predecessor is still going is skipped, not overlapped —
   *  two concurrent runs of one retention job is how a retention job corrupts its own table. */
  readonly #inflight = new Map<string, Promise<void>>()
  #abort = new AbortController()
  #timer: unknown = null
  #started = false
  #paused = false

  constructor(db: AppDatabase, options: { clock?: Clock } = {}) {
    this.#db = db
    this.#clock = options.clock ?? systemClock
  }

  /** Declare a schedule. Callable before or after start(); a late registration (a plugin reload) mints
   *  its state row and re-arms the timer. */
  register(entry: DeclaredSchedule): { dispose(): void } {
    if (!entry.key.includes(':')) throw new Error(`A schedule key must be '<owner>:<id>': '${entry.key}'.`)
    if (this.#declared.has(entry.key)) throw new Error(`Schedule already registered: ${entry.key}`)
    this.#declared.set(entry.key, entry)
    if (this.#started) void this.#sync()
    return {
      dispose: () => {
        // The definition goes; the STATE row stays. That retention is what makes a plugin's lifecycle
        // non-destructive — its pause and its history are waiting when it comes back.
        this.#declared.delete(entry.key)
        if (this.#started) this.#arm()
      },
    }
  }

  /** Register what a user schedule of `kind` actually does. Phase 3 fills this; until then every user
   *  row is inert and says so. */
  registerTarget(target: ScheduleTarget): { dispose(): void } {
    if (this.#targets.has(target.kind)) throw new Error(`Schedule target already registered: ${target.kind}`)
    this.#targets.set(target.kind, target)
    if (this.#started) void this.#sync()
    return { dispose: () => void this.#targets.delete(target.kind) }
  }

  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    this.#abort = new AbortController()
    const pause = await this.#db.select().from(schema.scheduleState).where(eq(schema.scheduleState.key, PAUSE_KEY))
    this.#paused = pause[0]?.enabledOverride === 0
    await this.#sync()
  }

  /** Stop arming and let in-flight runs finish. Called from the composition roots' ordered drain, after
   *  the listener is closed and before plugins and SQLite go: a run holds a database handle. */
  async stop(): Promise<void> {
    if (!this.#started) return
    this.#started = false
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer)
    this.#timer = null
    this.#abort.abort()
    await Promise.allSettled([...this.#inflight.values()])
  }

  paused(): boolean {
    return this.#paused
  }

  async setPaused(paused: boolean): Promise<void> {
    this.#paused = paused
    await this.#writeState(PAUSE_KEY, { enabledOverride: paused ? 0 : 1, nextRunAt: 0 })
    this.#arm()
  }

  async list(): Promise<ScheduleRow[]> {
    const entries = await this.#entries()
    return entries.map(toRow).sort((a, b) => a.key.localeCompare(b.key))
  }

  async runs(key: string): Promise<ScheduleRun[]> {
    const rows = await this.#db
      .select()
      .from(schema.scheduleRuns)
      .where(eq(schema.scheduleRuns.key, key))
      .orderBy(desc(schema.scheduleRuns.startedAt))
      .limit(RUN_RING)
    return rows.map((row) => ({
      startedAt: row.startedAt,
      ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
      status: row.status as ScheduleStatus,
      ...(row.detail === null ? {} : { detail: row.detail }),
    }))
  }

  /** Create a user schedule. The one NON-tolerant edge in this module: a create names a target that must
   *  resolve NOW, and the risk tier is read off that target and stamped onto the row here. That stamp is
   *  the consent record — 3am cannot answer a confirmation strip, so consent is taken once, at creation. */
  async create(input: CreateScheduleInput): Promise<ScheduleRow> {
    const target = this.#targets.get(input.kind)
    if (!target) throw new BridgeError(400, 'bad_request', `This node has nothing that can run a '${input.kind}' schedule.`)
    const parsed = target.parse(input.target)
    if (parsed === null) throw new BridgeError(400, 'bad_request', `That is not a valid target for a '${input.kind}' schedule.`)
    const id = randomUUID()
    const cadence = clampCadence(input.cadence)
    await this.#db.insert(schema.userSchedules).values({
      id,
      name: input.name,
      kind: input.kind,
      target: JSON.stringify(parsed),
      cadence: JSON.stringify(cadence),
      risk: target.risk ?? null,
      createdAt: this.#clock.now(),
    })
    await this.#sync()
    return this.#row(`user:${id}`)
  }

  async patch(key: string, input: PatchScheduleInput): Promise<ScheduleRow> {
    const entry = await this.#entry(key)
    if (input.name !== undefined) {
      // A declared schedule's name belongs to the code or manifest that declares it; renaming it here
      // would be a second source of truth that a reload silently wins.
      if (keyOwner(key).owner !== 'user') throw new BridgeError(409, 'conflict', 'Only a schedule you created can be renamed.')
      await this.#db.update(schema.userSchedules).set({ name: input.name }).where(eq(schema.userSchedules.id, key.slice(5)))
    }
    const patch: Partial<StateRow> = {}
    if (input.enabled !== undefined) patch.enabledOverride = input.enabled ? 1 : 0
    if (input.cadence !== undefined) {
      const cadence = clampCadence(input.cadence, floorFor(key))
      // Retuning re-times the NEXT run from now. Leaving nextRunAt alone would mean "every 5 minutes"
      // changed to "every hour" still fires in the next few minutes, once, for no reason.
      patch.cadenceOverride = JSON.stringify(cadence)
      patch.nextRunAt = nextRunAt(cadence, this.#clock.now(), this.#clock.random)
    }
    // Resuming a schedule that has been off for a week must not fire the moment it comes back for every
    // interval it slept through — catch-up-once applies, and the tick loop is where that happens.
    if (Object.keys(patch).length > 0) await this.#writeState(key, { ...patch, nextRunAt: patch.nextRunAt ?? entry.state.nextRunAt })
    this.#arm()
    return this.#row(key)
  }

  async remove(key: string): Promise<void> {
    if (keyOwner(key).owner !== 'user') {
      throw new BridgeError(409, 'conflict', 'A schedule declared by acorn or a plugin cannot be deleted — pause it instead.')
    }
    await this.#entry(key)
    await this.#db.delete(schema.userSchedules).where(eq(schema.userSchedules.id, key.slice(5)))
    await this.#db.delete(schema.scheduleState).where(eq(schema.scheduleState.key, key))
    await this.#db.delete(schema.scheduleRuns).where(eq(schema.scheduleRuns.key, key))
    this.#arm()
  }

  /** Run now. Subject to serialization and the concurrency cap, NOT to backoff — a human pressing the
   *  button is how you test your way out of a backoff. */
  async runNow(key: string): Promise<ScheduleRun> {
    const entry = await this.#entry(key)
    if (!entry.registered || !entry.run) {
      throw new BridgeError(409, 'conflict', 'Nothing on this node can run that schedule right now.')
    }
    if (this.#inflight.has(key)) throw new BridgeError(409, 'conflict', 'That schedule is already running.')
    if (this.#inflight.size >= CONCURRENCY) throw new BridgeError(409, 'conflict', 'The node is already running as many scheduled jobs as it allows.')
    await this.#execute(entry, 'manual')
    return (await this.runs(key))[0]!
  }

  // ── the loop ────────────────────────────────────────────────────────────────────────────────────
  //
  // ONE timer, armed for the earliest nextRunAt and re-armed after every run and every mutation. Not one
  // timer per schedule: a single timer cannot leak, and "what fires next" is one comparison.

  #arm(): void {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer)
    this.#timer = null
    if (!this.#started || this.#paused) return
    void this.#entries().then((entries) => {
      if (!this.#started || this.#paused) return
      const candidates = entries.filter((entry) => entry.enabled && entry.registered && !this.#inflight.has(entry.key))
      if (candidates.length === 0) return
      const soonest = Math.min(...candidates.map((entry) => entry.state.nextRunAt))
      let delay = Math.max(0, soonest - this.#clock.now())
      // ponytail: at the cap, back off a second rather than arming a zero-delay timer that would spin
      // until a slot frees. Completions re-arm anyway, so this only covers the case where every slot is
      // held by a long run.
      if (this.#inflight.size >= CONCURRENCY) delay = Math.max(delay, 1_000)
      // Last arm wins, with the freshest read. Two arms can be in flight (a mutation racing a
      // completion) and the one that resolves second is the one that saw the newer state.
      if (this.#timer !== null) this.#clock.clearTimeout(this.#timer)
      this.#timer = this.#clock.setTimeout(() => void this.#tick(), delay)
    })
  }

  async #tick(): Promise<void> {
    this.#timer = null
    if (!this.#started || this.#paused) return
    const now = this.#clock.now()
    const due = (await this.#entries())
      .filter((entry) => entry.enabled && entry.registered && entry.state.nextRunAt <= now)
      .sort((a, b) => a.state.nextRunAt - b.state.nextRunAt)
    for (const entry of due) {
      if (this.#inflight.size >= CONCURRENCY) break // the rest stay due and are picked up on the next arm
      // Catch-up, NOT backfill: a schedule the node slept through runs ONCE and then resumes from now.
      // Replaying a week of missed hourly samples would fabricate history the node did not witness.
      const late = now - entry.state.nextRunAt > cadencePeriodMs(entry.cadence)
      void this.#execute(entry, late ? 'catch-up' : 'due')
    }
    this.#arm()
  }

  #execute(entry: Entry, reason: 'due' | 'manual' | 'catch-up'): Promise<void> {
    if (this.#inflight.has(entry.key)) {
      // Skipped rather than queued: the previous run is still the current answer, and a queue of one is
      // just a slower overlap.
      return this.#recordSkip(entry, 'the previous run had not finished')
    }
    const run = this.#runOnce(entry, reason).finally(() => {
      this.#inflight.delete(entry.key)
      this.#arm()
    })
    this.#inflight.set(entry.key, run)
    return run
  }

  async #runOnce(entry: Entry, reason: 'due' | 'manual' | 'catch-up'): Promise<void> {
    const startedAt = this.#clock.now()
    const timeout = AbortSignal.timeout(entry.timeoutMs)
    const signal = AbortSignal.any([timeout, this.#abort.signal])
    let status: ScheduleStatus = 'ok'
    let detail = reason === 'catch-up' ? 'catch-up' : undefined
    try {
      // Failures are contained per run: the run row and lastError are the blast radius, never a crashed
      // node. A timed-out runner is not killed — nothing here can kill it — so the signal is a contract
      // it is expected to honour, and the slot is released either way.
      const result = await Promise.race([
        entry.run!(signal),
        new Promise<never>((_, reject) => timeout.addEventListener('abort', () => reject(new Error('timed out')), { once: true })),
      ])
      if (typeof result === 'string' && result) detail = detail ? `${detail}; ${result}` : result
    } catch (error) {
      status = timeout.aborted ? 'timeout' : 'error'
      detail = oneLine(error)
      console.warn(`[schedules] ${entry.key} ${status}: ${detail}`)
    }
    const finishedAt = this.#clock.now()
    await this.#recordRun(entry.key, { startedAt, finishedAt, status, detail })
    await this.#writeState(entry.key, await this.#afterRun(entry, status, finishedAt, detail))
  }

  /** What the state row becomes after a run: the next fire time, the last-run facts, and — on failure —
   *  a VISIBLE backoff, because a silent retry loop is how rate limits die. */
  async #afterRun(entry: Entry, status: ScheduleStatus, finishedAt: number, detail?: string): Promise<Partial<StateRow>> {
    const normal = nextRunAt(entry.cadence, finishedAt, this.#clock.random)
    if (status === 'ok') {
      return { nextRunAt: normal, lastRunAt: finishedAt, lastStatus: status, lastError: null, backoffUntil: null }
    }
    const failures = await this.#consecutiveFailures(entry.key)
    // Never EARLIER than the cadence would have fired anyway: a failing daily job must not start
    // retrying every six hours just because the cap is six hours.
    const backoffUntil = Math.max(normal, finishedAt + Math.min(cadencePeriodMs(entry.cadence) * 2 ** failures, MAX_BACKOFF_MS))
    return {
      nextRunAt: backoffUntil,
      lastRunAt: finishedAt,
      lastStatus: status,
      lastError: detail ?? status,
      backoffUntil,
    }
  }

  async #consecutiveFailures(key: string): Promise<number> {
    const recent = await this.runs(key)
    let count = 0
    for (const run of recent) {
      if (run.status === 'skipped') continue // a skip says nothing about the job's health
      if (run.status === 'ok') break
      count += 1
    }
    return Math.max(count, 1)
  }

  async #recordSkip(entry: Entry, why: string): Promise<void> {
    const at = this.#clock.now()
    await this.#recordRun(entry.key, { startedAt: at, finishedAt: at, status: 'skipped', detail: why })
    await this.#writeState(entry.key, { nextRunAt: nextRunAt(entry.cadence, at, this.#clock.random) })
  }

  async #recordRun(key: string, run: { startedAt: number; finishedAt: number; status: ScheduleStatus; detail?: string }): Promise<void> {
    await this.#db
      .insert(schema.scheduleRuns)
      .values({ key, startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status, detail: run.detail ?? null })
      // Two runs of one key inside the same millisecond cannot overlap (serialization), but a fast job
      // run twice by hand can land on the same timestamp — overwrite rather than lose the newer one.
      .onConflictDoUpdate({
        target: [schema.scheduleRuns.key, schema.scheduleRuns.startedAt],
        set: { finishedAt: run.finishedAt, status: run.status, detail: run.detail ?? null },
      })
    // Trim to the ring on write, so the table is bounded by construction and nothing has to sweep it.
    const keep = await this.#db
      .select({ startedAt: schema.scheduleRuns.startedAt })
      .from(schema.scheduleRuns)
      .where(eq(schema.scheduleRuns.key, key))
      .orderBy(desc(schema.scheduleRuns.startedAt))
      .limit(RUN_RING)
    if (keep.length === RUN_RING) {
      await this.#db.delete(schema.scheduleRuns).where(
        and(
          eq(schema.scheduleRuns.key, key),
          notInArray(
            schema.scheduleRuns.startedAt,
            keep.map((row) => row.startedAt),
          ),
        ),
      )
    }
  }

  // ── state ───────────────────────────────────────────────────────────────────────────────────────

  async #writeState(key: string, patch: Partial<StateRow>): Promise<void> {
    await this.#db
      .insert(schema.scheduleState)
      .values({ key, ...patch, nextRunAt: patch.nextRunAt ?? 0 })
      .onConflictDoUpdate({ target: schema.scheduleState.key, set: patch })
  }

  /** Mint a state row for anything that has just become declarable, then re-arm. Idempotent, and the
   *  only place a nextRunAt is invented. */
  async #sync(): Promise<void> {
    const known = new Set((await this.#db.select({ key: schema.scheduleState.key }).from(schema.scheduleState)).map((row) => row.key))
    const now = this.#clock.now()
    for (const entry of await this.#entries()) {
      if (known.has(entry.key)) continue
      await this.#writeState(entry.key, { nextRunAt: nextRunAt(entry.cadence, now, this.#clock.random) })
    }
    this.#arm()
  }

  /** The merged view, rebuilt per read. The three tables hold tens of rows between them, so re-reading
   *  is cheaper than any cache that could go stale behind a plugin reload or a second writer. */
  async #entries(): Promise<Entry[]> {
    const [stateRows, userRows] = await Promise.all([
      this.#db.select().from(schema.scheduleState).where(notInArray(schema.scheduleState.key, [PAUSE_KEY])),
      this.#db.select().from(schema.userSchedules),
    ])
    const state = new Map(stateRows.map((row) => [row.key, row]))
    const entries: Entry[] = []
    const seen = new Set<string>()

    for (const declared of this.#declared.values()) {
      seen.add(declared.key)
      entries.push(this.#entryFor(declared.key, state.get(declared.key), {
        name: declared.name,
        kind: keyOwner(declared.key).owner === 'core' ? 'core' : 'plugin',
        cadence: declared.cadence,
        enabled: declared.enabled ?? true,
        registered: true,
        timeoutMs: Math.min(declared.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
        run: declared.run,
      }))
    }

    for (const row of userRows) {
      const key = `user:${row.id}`
      seen.add(key)
      const target = this.#targets.get(row.kind)
      entries.push(this.#entryFor(key, state.get(key), {
        name: row.name,
        kind: row.kind,
        // A stored cadence that no longer parses falls back to the floor rather than making the row
        // unreadable — tolerant codec, same as an unknown panel view kind.
        cadence: parseCadence(safeJson(row.cadence)) ?? { every: CADENCE_MIN_SECONDS },
        enabled: true,
        registered: target !== undefined,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        ...(row.risk ? { risk: row.risk as ToolRisk } : {}),
        ...(target ? { run: (signal: AbortSignal) => target.run(safeJson(row.target), signal) } : {}),
      }))
    }

    // Retained state rows whose declaration is currently absent: a disabled plugin, an uninstalled one,
    // a core schedule this version no longer declares. Listed, never run, never deleted — the pause and
    // the history are waiting for the plugin's return.
    for (const row of stateRows) {
      if (seen.has(row.key)) continue
      entries.push(this.#entryFor(row.key, row, {
        name: row.key,
        kind: 'unknown',
        cadence: { every: CADENCE_MIN_SECONDS },
        enabled: true,
        registered: false,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }))
    }
    return entries
  }

  #entryFor(
    key: string,
    row: StateRow | undefined,
    declared: Omit<Entry, 'key' | 'state' | 'declaredCadence'>,
  ): Entry {
    const state: StateRow = row ?? {
      key,
      enabledOverride: null,
      cadenceOverride: null,
      // Not persisted here — #sync mints the real one. Until then the entry reads as "not due yet",
      // which is the safe direction for the sliver of time before a row exists.
      nextRunAt: this.#clock.now() + cadencePeriodMs(declared.cadence),
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      backoffUntil: null,
    }
    const override = state.cadenceOverride ? parseCadence(safeJson(state.cadenceOverride), floorFor(key)) : null
    return {
      ...declared,
      key,
      state,
      declaredCadence: declared.cadence,
      cadence: override ?? declared.cadence,
      enabled: state.enabledOverride === null ? declared.enabled : state.enabledOverride === 1,
    }
  }

  async #entry(key: string): Promise<Entry> {
    const entry = (await this.#entries()).find((candidate) => candidate.key === key)
    if (!entry) throw new BridgeError(404, 'not_found', 'No such schedule.')
    return entry
  }

  async #row(key: string): Promise<ScheduleRow> {
    return toRow(await this.#entry(key))
  }
}

function toRow(entry: Entry): ScheduleRow {
  const owner = keyOwner(entry.key)
  const retuned = entry.state.cadenceOverride !== null
  return {
    key: entry.key,
    owner: owner.owner,
    ...(owner.owner === 'plugin' ? { pluginId: owner.pluginId } : {}),
    name: entry.name,
    kind: entry.kind,
    cadence: entry.cadence,
    ...(retuned ? { declaredCadence: entry.declaredCadence } : {}),
    enabled: entry.enabled,
    registered: entry.registered,
    nextRunAt: entry.state.nextRunAt,
    ...(entry.state.lastRunAt === null ? {} : { lastRunAt: entry.state.lastRunAt }),
    ...(entry.state.lastStatus === null ? {} : { lastStatus: entry.state.lastStatus as ScheduleStatus }),
    ...(entry.state.lastError === null ? {} : { lastError: entry.state.lastError }),
    ...(entry.state.backoffUntil === null ? {} : { backoffUntil: entry.state.backoffUntil }),
    ...(entry.risk ? { risk: entry.risk } : {}),
  }
}

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** One line, because that is what a run row and a settings list can carry. */
const oneLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 300)
