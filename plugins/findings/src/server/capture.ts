import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import {
  FINDING_LIMITS,
  findingRecordInputSchema,
  type FindingListOptions,
  type FindingListPage,
  type FindingObservation,
  type FindingOrigin,
  type FindingRecordInput,
  type FindingRecordResult,
  type FindingScope,
  findingOriginSchema,
  findingScopeSchema,
} from '../contract/records'
import type { FindingKindDescriptor } from '../contract/extensions'
import { findingScopeRevisions, observations, observationWithdrawals } from '../node/schema'

type ScopeSnapshot = {
  scope: FindingScope
  labels: FindingObservation['scopeLabels']
  taskId: string | null
  projectId: string | null
  workspaceId: string | null
}

type CaptureDeps = {
  db: PluginDatabase
  core: Pick<CoreServices, 'fs' | 'projects' | 'tasks'>
  kinds(): readonly { id: string; descriptor: FindingKindDescriptor }[]
  now?: () => number
  uuid?: () => string
}

export class FindingCaptureError extends Error {
  constructor(
    public readonly kind: 'invalid-input' | 'not-found' | 'conflict' | 'forbidden' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'FindingCaptureError'
  }
}

const parseJson = <T>(value: string): T => JSON.parse(value) as T
const scopeKey = (scope: FindingScope): string => {
  switch (scope.kind) {
    case 'task': return `task:${scope.taskId}`
    case 'project': return `project:${scope.projectId}`
    case 'workspace': return `workspace:${scope.workspaceId}`
    case 'private': return 'private'
  }
}
const sourceNamespace = (origin: FindingOrigin, producerId: string): string =>
  origin.kind === 'agent'
    ? `agent:${origin.sessionId}`
    : origin.kind === 'device'
      ? `device:${origin.deviceId}`
      : origin.kind === 'plugin'
        ? `plugin:${producerId}`
        : origin.kind === 'workflow'
          ? `workflow:${origin.runId}`
          : origin.kind === 'schedule'
            ? `schedule:${origin.scheduleId}:${origin.runId}`
            : `legacy:${origin.proposalId}`

type ObservationRow = typeof observations.$inferSelect
type WithdrawalRow = typeof observationWithdrawals.$inferSelect

function cursorFor(row: Pick<ObservationRow, 'createdAt' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url')
}

function parseCursor(cursor: string | undefined): [number, string] | null {
  if (!cursor || cursor.length > 400) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || typeof parsed[1] !== 'string') return null
    return [parsed[0] as number, parsed[1]]
  } catch {
    return null
  }
}

function rowToObservation(
  row: ObservationRow,
  withdrawal: WithdrawalRow | null,
  availableKind: FindingKindDescriptor | undefined,
): FindingObservation {
  const origin = parseJson<FindingOrigin>(row.originJson)
  return {
    id: row.id,
    scope: row.scopeKind === 'task'
      ? { kind: 'task', taskId: row.taskId! }
      : row.scopeKind === 'project'
        ? { kind: 'project', projectId: row.projectId! }
        : row.scopeKind === 'workspace'
          ? { kind: 'workspace', workspaceId: row.workspaceId! }
          : { kind: 'private' },
    scopeLabels: parseJson<FindingObservation['scopeLabels']>(row.scopeLabelsJson),
    origin,
    kind: {
      id: row.kindId,
      version: row.kindVersion,
      label: availableKind?.label ?? row.kindLabel,
      available: !!availableKind,
    },
    title: row.title,
    body: row.body,
    claimStatus: row.claimStatus as FindingObservation['claimStatus'],
    sourceKey: row.sourceKey,
    evidence: parseJson<FindingObservation['evidence']>(row.evidenceJson),
    ...(row.correctsObservationId ? { correctsObservationId: row.correctsObservationId } : {}),
    createdAt: row.createdAt,
    withdrawal: withdrawal
      ? { actor: { kind: withdrawal.actorKind as 'agent' | 'device' | 'plugin', id: withdrawal.actorId }, reason: withdrawal.reason, withdrawnAt: withdrawal.withdrawnAt }
      : null,
  }
}

export class FindingCapture {
  readonly #db: PluginDatabase
  readonly #core: CaptureDeps['core']
  readonly #kinds: CaptureDeps['kinds']
  readonly #now: () => number
  readonly #uuid: () => string

  constructor(deps: CaptureDeps) {
    this.#db = deps.db
    this.#core = deps.core
    this.#kinds = deps.kinds
    this.#now = deps.now ?? Date.now
    this.#uuid = deps.uuid ?? randomUUID
  }

  #kind(id: string, version: number): FindingKindDescriptor | undefined {
    return this.#kinds().find((entry) => entry.id === id && entry.descriptor.version === version)?.descriptor
  }

  async #scope(scope: FindingScope): Promise<ScopeSnapshot> {
    if (scope.kind === 'private') return { scope, labels: {}, taskId: null, projectId: null, workspaceId: null }
    if (scope.kind === 'workspace') {
      // ProjectService is the existing public proof that a workspace id is live. Core intentionally
      // exposes no generic workspace-row capability; an empty workspace therefore cannot be targeted
      // by a producer-bound phase-1 writer until a concrete consumer proves that wider seam necessary.
      const projects = await this.#core.projects.byWorkspace(scope.workspaceId)
      if (!projects.length) throw new FindingCaptureError('not-found', 'no such populated workspace')
      return { scope, labels: { workspace: scope.workspaceId }, taskId: null, projectId: null, workspaceId: scope.workspaceId }
    }
    if (scope.kind === 'project') {
      const project = await this.#core.projects.byId(scope.projectId)
      if (!project) throw new FindingCaptureError('not-found', 'no such project')
      return {
        scope,
        labels: { project: project.name, workspace: project.workspaceId },
        taskId: null,
        projectId: project.id,
        workspaceId: project.workspaceId,
      }
    }
    const task = await this.#core.tasks.load(scope.taskId)
    if (!task) throw new FindingCaptureError('not-found', 'no such task')
    const project = await this.#core.projects.byId(task.projectId)
    if (!project) throw new FindingCaptureError('not-found', 'task project is unavailable')
    return {
      scope,
      labels: { task: task.title, project: project.name, workspace: project.workspaceId },
      taskId: task.id,
      projectId: project.id,
      workspaceId: project.workspaceId,
    }
  }

  async #validateEvidence(scope: ScopeSnapshot, input: FindingRecordInput): Promise<void> {
    for (const evidence of input.evidence) {
      if (evidence.kind !== 'observation') continue
      const linked = this.#db.select({ id: observations.id }).from(observations).where(and(
        eq(observations.id, evidence.observationId),
        eq(observations.scopeKind, scope.scope.kind),
        scope.taskId ? eq(observations.taskId, scope.taskId) : undefined,
        scope.projectId ? eq(observations.projectId, scope.projectId) : undefined,
        scope.workspaceId ? eq(observations.workspaceId, scope.workspaceId) : undefined,
      )).get()
      if (!linked) throw new FindingCaptureError('invalid-input', `evidence observation '${evidence.observationId}' is not in this scope`)
    }
    const repository = input.evidence.filter((entry) => entry.kind === 'repository')
    if (!repository.length) return
    const root = scope.taskId
      ? (await this.#core.tasks.load(scope.taskId))?.worktreePath ?? (scope.projectId ? (await this.#core.projects.byId(scope.projectId))?.path : null)
      : scope.projectId
        ? (await this.#core.projects.byId(scope.projectId))?.path
        : null
    if (!root) throw new FindingCaptureError('invalid-input', 'repository evidence requires a task or project with a mapped checkout')
    for (const evidence of repository) {
      if (!this.#core.fs.resolveInRoot(root, evidence.path)) {
        throw new FindingCaptureError('invalid-input', `repository evidence path escapes the task checkout: ${evidence.path}`)
      }
    }
  }

  async recordBatch(args: {
    scope: FindingScope
    origin: FindingOrigin
    producerId: string
    inputs: readonly FindingRecordInput[]
    allowedKinds?: ReadonlySet<string>
  }): Promise<FindingRecordResult[]> {
    if (!args.inputs.length || args.inputs.length > FINDING_LIMITS.observationsPerBatch) {
      throw new FindingCaptureError('invalid-input', `a capture batch must contain 1-${FINDING_LIMITS.observationsPerBatch} observations`)
    }
    const parsedScope = findingScopeSchema.safeParse(args.scope)
    const parsedOrigin = findingOriginSchema.safeParse(args.origin)
    if (!parsedScope.success || !parsedOrigin.success) {
      const issues = [...(parsedScope.success ? [] : parsedScope.error.issues), ...(parsedOrigin.success ? [] : parsedOrigin.error.issues)]
      throw new FindingCaptureError('invalid-input', issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '))
    }
    const scope = await this.#scope(parsedScope.data)
    const prepared: Array<{ input: FindingRecordInput; kind: FindingKindDescriptor }> = []
    for (const raw of args.inputs) {
      const parsed = findingRecordInputSchema.safeParse(raw)
      if (!parsed.success) throw new FindingCaptureError('invalid-input', parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; '))
      const input = parsed.data
      if (args.allowedKinds && !args.allowedKinds.has(input.kind)) {
        throw new FindingCaptureError('forbidden', `producer '${args.producerId}' cannot record kind '${input.kind}'`)
      }
      const kind = this.#kind(input.kind, input.kindVersion)
      if (!kind) throw new FindingCaptureError('unavailable', `finding kind '${input.kind}' version ${input.kindVersion} is unavailable`)
      try {
        kind.validate?.(input)
      } catch (error) {
        throw new FindingCaptureError('invalid-input', error instanceof Error ? error.message : 'finding kind validation failed')
      }
      await this.#validateEvidence(scope, input)
      prepared.push({ input, kind })
    }

    const namespace = `${scopeKey(parsedScope.data)}:${sourceNamespace(parsedOrigin.data, args.producerId)}`
    const at = this.#now()
    const key = scopeKey(args.scope)
    return this.#db.transaction((tx) => {
      const staged = new Map<string, { result: FindingRecordResult; hash: string }>()
      const pending: Array<{ id: string; input: FindingRecordInput; kind: FindingKindDescriptor; hash: string }> = []

      for (const { input, kind } of prepared) {
        const hash = createHash('sha256').update(JSON.stringify({ scope: parsedScope.data, origin: parsedOrigin.data, input })).digest('hex')
        const inBatch = staged.get(input.sourceKey)
        if (inBatch) {
          if (inBatch.hash !== hash) throw new FindingCaptureError('conflict', `source key '${input.sourceKey}' was reused with different content`)
          continue
        }
        const existing = tx.select({ id: observations.id, payloadHash: observations.payloadHash })
          .from(observations)
          .where(and(eq(observations.sourceNamespace, namespace), eq(observations.sourceKey, input.sourceKey)))
          .get()
        if (existing) {
          if (existing.payloadHash !== hash) throw new FindingCaptureError('conflict', `source key '${input.sourceKey}' was reused with different content`)
          staged.set(input.sourceKey, { result: { id: existing.id, created: false, revision: 0 }, hash })
          continue
        }
        if (input.correctsObservationId) {
          const corrected = tx.select({ id: observations.id }).from(observations)
            .where(and(eq(observations.id, input.correctsObservationId), eq(observations.scopeKind, scope.scope.kind),
              scope.taskId ? eq(observations.taskId, scope.taskId) : undefined,
              scope.projectId ? eq(observations.projectId, scope.projectId) : undefined,
              scope.workspaceId ? eq(observations.workspaceId, scope.workspaceId) : undefined))
            .get()
          if (!corrected) throw new FindingCaptureError('invalid-input', `corrected observation '${input.correctsObservationId}' is not in this scope`)
        }
        const id = this.#uuid()
        pending.push({ id, input, kind, hash })
        staged.set(input.sourceKey, { result: { id, created: true, revision: 0 }, hash })
      }

      let revision = tx.select({ revision: findingScopeRevisions.revision }).from(findingScopeRevisions).where(eq(findingScopeRevisions.scopeKey, key)).get()?.revision ?? 0
      if (pending.length) {
        for (const { id, input, kind, hash } of pending) {
          tx.insert(observations).values({
            id,
            scopeKind: scope.scope.kind,
            taskId: scope.taskId,
            projectId: scope.projectId,
            workspaceId: scope.workspaceId,
            scopeLabelsJson: JSON.stringify(scope.labels),
            originKind: parsedOrigin.data.kind,
            originJson: JSON.stringify(parsedOrigin.data),
            producerId: args.producerId,
            kindId: input.kind,
            kindVersion: input.kindVersion,
            kindLabel: kind.label,
            title: input.title,
            body: input.body,
            claimStatus: input.claimStatus,
            sourceNamespace: namespace,
            sourceKey: input.sourceKey,
            payloadHash: hash,
            evidenceJson: JSON.stringify(input.evidence),
            correctsObservationId: input.correctsObservationId ?? null,
            createdAt: at,
          }).run()
        }
        const bumped = tx.insert(findingScopeRevisions).values({ scopeKey: key, revision: 1, updatedAt: at })
          .onConflictDoUpdate({
            target: findingScopeRevisions.scopeKey,
            set: { revision: sql`${findingScopeRevisions.revision} + 1`, updatedAt: at },
          })
          .returning({ revision: findingScopeRevisions.revision })
          .get()
        revision = bumped!.revision
      }
      return prepared.map(({ input }) => ({ ...staged.get(input.sourceKey)!.result, revision }))
    })
  }

  async record(args: Omit<Parameters<FindingCapture['recordBatch']>[0], 'inputs'> & { input: FindingRecordInput }): Promise<FindingRecordResult> {
    return (await this.recordBatch({ ...args, inputs: [args.input] }))[0]!
  }

  async listTask(taskId: string, options: FindingListOptions = {}): Promise<FindingListPage> {
    const limit = Math.max(1, Math.min(FINDING_LIMITS.pageSize, options.limit ?? 50))
    const cursor = parseCursor(options.cursor)
    if (options.cursor && !cursor) throw new FindingCaptureError('invalid-input', 'invalid findings cursor')
    const rows = this.#db.select({ observation: observations, withdrawal: observationWithdrawals })
      .from(observations)
      .leftJoin(observationWithdrawals, eq(observationWithdrawals.observationId, observations.id))
      .where(and(
        eq(observations.scopeKind, 'task'),
        eq(observations.taskId, taskId),
        options.state === 'active' ? isNull(observationWithdrawals.observationId) : undefined,
        cursor ? or(lt(observations.createdAt, cursor[0]), and(eq(observations.createdAt, cursor[0]), lt(observations.id, cursor[1]))) : undefined,
      ))
      .orderBy(desc(observations.createdAt), desc(observations.id))
      .limit(limit + 1)
      .all()
    const page = rows.slice(0, limit)
    const revision = this.#db.select({ revision: findingScopeRevisions.revision }).from(findingScopeRevisions)
      .where(eq(findingScopeRevisions.scopeKey, `task:${taskId}`)).get()?.revision ?? 0
    return {
      items: page.map(({ observation, withdrawal }) => rowToObservation(observation, withdrawal, this.#kind(observation.kindId, observation.kindVersion))),
      nextCursor: rows.length > limit ? cursorFor(page.at(-1)!.observation) : null,
      revision,
    }
  }

  getTask(taskId: string, observationId: string): FindingObservation | null {
    const row = this.#db.select({ observation: observations, withdrawal: observationWithdrawals })
      .from(observations)
      .leftJoin(observationWithdrawals, eq(observationWithdrawals.observationId, observations.id))
      .where(and(eq(observations.id, observationId), eq(observations.scopeKind, 'task'), eq(observations.taskId, taskId)))
      .get()
    return row ? rowToObservation(row.observation, row.withdrawal, this.#kind(row.observation.kindId, row.observation.kindVersion)) : null
  }

  getMany(ids: readonly string[]): FindingObservation[] {
    if (!ids.length) return []
    const rows = this.#db.select({ observation: observations, withdrawal: observationWithdrawals })
      .from(observations).leftJoin(observationWithdrawals, eq(observationWithdrawals.observationId, observations.id))
      .where(inArray(observations.id, [...ids])).all()
    const byId = new Map(rows.map(({ observation, withdrawal }) => [observation.id, rowToObservation(observation, withdrawal, this.#kind(observation.kindId, observation.kindVersion))]))
    return ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : [])
  }

  withdrawTask(args: { taskId: string; observationId: string; actor: { kind: 'agent' | 'device'; id: string }; reason?: string }): { changed: boolean; revision: number } {
    const reason = args.reason?.trim() || null
    if (reason && reason.length > FINDING_LIMITS.reasonChars) throw new FindingCaptureError('invalid-input', `reason exceeds ${FINDING_LIMITS.reasonChars} characters`)
    const at = this.#now()
    return this.#db.transaction((tx) => {
      const row = tx.select({ originJson: observations.originJson }).from(observations)
        .where(and(eq(observations.id, args.observationId), eq(observations.scopeKind, 'task'), eq(observations.taskId, args.taskId)))
        .get()
      if (!row) throw new FindingCaptureError('not-found', 'no such observation')
      const origin = parseJson<FindingOrigin>(row.originJson)
      if (args.actor.kind === 'agent' && (origin.kind !== 'agent' || origin.sessionId !== args.actor.id)) {
        throw new FindingCaptureError('forbidden', 'an agent may withdraw only its own observation')
      }
      const existing = tx.select({ observationId: observationWithdrawals.observationId }).from(observationWithdrawals)
        .where(eq(observationWithdrawals.observationId, args.observationId)).get()
      let revision = tx.select({ revision: findingScopeRevisions.revision }).from(findingScopeRevisions)
        .where(eq(findingScopeRevisions.scopeKey, `task:${args.taskId}`)).get()?.revision ?? 0
      if (!existing) {
        tx.insert(observationWithdrawals).values({
          observationId: args.observationId,
          actorKind: args.actor.kind,
          actorId: args.actor.id,
          reason,
          withdrawnAt: at,
        }).run()
        revision = tx.insert(findingScopeRevisions).values({ scopeKey: `task:${args.taskId}`, revision: 1, updatedAt: at })
          .onConflictDoUpdate({ target: findingScopeRevisions.scopeKey, set: { revision: sql`${findingScopeRevisions.revision} + 1`, updatedAt: at } })
          .returning({ revision: findingScopeRevisions.revision }).get()!.revision
      }
      return { changed: !existing, revision }
    })
  }
}
