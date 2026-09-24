import { eq } from 'drizzle-orm'
import type { CoreServices, PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentReviewInputCapability, AgentReviewInputRef } from '@acorn/plugin-agents/contract/lifecycle.ts'
import type { TerminalCompletedEvent, TerminalReviewInputCapability } from '@acorn/plugin-terminal/contract/reviewInput.ts'
import type { WorkflowCompletedEvent, WorkflowReviewInputCapability } from '@acorn/plugin-workflows/contract/reviewInput.ts'
import type {
  FindingsBoundaryInput,
  FindingsLifecycleCheckpoint,
  FindingsReviewSettings,
} from '../contract/lifecycle'
import { DEFAULT_FINDINGS_SETTINGS } from '../contract/lifecycle'
import type { FindingOrigin } from '../contract/records'
import type { FindingBundle } from '../contract/review'
import { findingBundleNotices, findingLifecycleCheckpoints } from '../node/schema'
import type { FindingsRuntime } from './runtime'
import { FindingCaptureError } from './capture'

export const FINDINGS_SETTINGS_KEY = 'findings_review_settings'
const LIFECYCLE_BODY_MAX_BYTES = 16 * 1024

export const truncateLifecycleBody = (value: string, maxBytes = LIFECYCLE_BODY_MAX_BYTES): string => {
  const encoded = Buffer.from(value, 'utf8')
  if (encoded.byteLength <= maxBytes) return value
  let start = encoded.byteLength - maxBytes
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) start += 1
  return encoded.subarray(start).toString('utf8')
}

const readSettingsValue = (raw: string | null): FindingsReviewSettings => {
  if (!raw) return DEFAULT_FINDINGS_SETTINGS
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    return {
      // A configured model now opts into archive review. Keep the old field canonical so older
      // clients can still read this preference without preserving the former silent opt-out.
      automaticPreparation: true,
      notifyWhenReady: value.notifyWhenReady === true,
      backendId: typeof value.backendId === 'string' && value.backendId ? value.backendId : null,
      modelId: typeof value.modelId === 'string' && value.modelId ? value.modelId : null,
      targetId: typeof value.targetId === 'string' && value.targetId ? value.targetId : null,
    }
  } catch {
    return DEFAULT_FINDINGS_SETTINGS
  }
}

export class FindingsLifecycle {
  constructor(private readonly options: {
    db: PluginDatabase
    runtime: FindingsRuntime
    core: Pick<CoreServices, 'identity' | 'prefs' | 'tasks'>
    agents(): AgentReviewInputCapability | undefined
    terminal?(): TerminalReviewInputCapability | undefined
    workflows?(): WorkflowReviewInputCapability | undefined
    notice(input: { taskId?: string; title: string; detail?: string; kind?: string; target?: { kind: string; resourceId: string } }): void
    settingsChanged(): void
    now?: () => number
  }) {}

  async settings(userId: string): Promise<FindingsReviewSettings> {
    return readSettingsValue(await this.options.core.prefs.read(userId, FINDINGS_SETTINGS_KEY))
  }

  async setSettings(userId: string, settings: FindingsReviewSettings): Promise<FindingsReviewSettings> {
    if (settings.targetId && !this.options.runtime.hasReviewTarget(settings.targetId)) throw new FindingCaptureError('unavailable', 'review target is unavailable')
    const normalized: FindingsReviewSettings = {
      automaticPreparation: true,
      notifyWhenReady: settings.notifyWhenReady === true,
      backendId: typeof settings.backendId === 'string' && settings.backendId ? settings.backendId : null,
      modelId: typeof settings.modelId === 'string' && settings.modelId ? settings.modelId : null,
      targetId: typeof settings.targetId === 'string' && settings.targetId ? settings.targetId : null,
    }
    await this.options.core.prefs.write(userId, FINDINGS_SETTINGS_KEY, JSON.stringify(normalized))
    this.options.settingsChanged()
    return normalized
  }

  async boundary(input: FindingsBoundaryInput): Promise<FindingsLifecycleCheckpoint> {
    if (input.body && Buffer.byteLength(input.body, 'utf8') > LIFECYCLE_BODY_MAX_BYTES) {
      input = { ...input, body: truncateLifecycleBody(input.body) }
    }
    const existing = this.options.db.select().from(findingLifecycleCheckpoints)
      .where(eq(findingLifecycleCheckpoints.boundaryKey, input.boundaryKey)).get()
    if (existing) {
      if (existing.taskId !== input.taskId || existing.sourceKind !== input.sourceKind
        || existing.sourceVersion !== input.sourceVersion || existing.title !== input.title
        || existing.body !== input.body || existing.availability !== input.availability
        || (existing.unavailableReason ?? undefined) !== input.unavailableReason) {
        throw new FindingCaptureError('conflict', `lifecycle boundary '${input.boundaryKey}' changed after capture`)
      }
      if (existing.sourceKind === 'task-archive' && !existing.preparedBundleId) await this.schedule(input)
      return this.toCheckpoint(existing)
    }
    const at = this.options.now?.() ?? Date.now()
    let observationId: string | null = null
    if (input.availability === 'available' && input.body?.trim()) {
      const origin: FindingOrigin = input.sourceKind === 'workflow'
        ? { kind: 'workflow', runId: /^workflow:([^:]+):terminal$/.exec(input.boundaryKey)?.[1] ?? input.sourceVersion }
        : input.sourceKind === 'agent'
          ? this.agentOrigin(input)
          : { kind: 'plugin', pluginId: input.sourceKind === 'terminal' ? 'terminal' : 'findings', invocationId: input.boundaryKey }
      const recorded = await this.options.runtime.record({
        scope: { kind: 'task', taskId: input.taskId },
        origin,
        producerId: `lifecycle:${input.sourceKind}`,
        input: {
          sourceKey: input.boundaryKey,
          kind: 'findings:review-input',
          kindVersion: 1,
          title: input.title.slice(0, 200),
          body: input.body,
          claimStatus: 'observed',
          evidence: [],
        },
      })
      observationId = recorded.id
    }
    this.options.db.insert(findingLifecycleCheckpoints).values({
      boundaryKey: input.boundaryKey,
      taskId: input.taskId,
      sourceKind: input.sourceKind,
      sourceVersion: input.sourceVersion,
      title: input.title,
      body: input.body,
      availability: input.availability,
      unavailableReason: input.unavailableReason ?? null,
      completedAt: input.completedAt,
      observationId,
      preparedBundleId: null,
      updatedAt: at,
    }).onConflictDoNothing().run()
    const checkpoint = this.checkpoint(input.boundaryKey)!
    if (checkpoint.taskId !== input.taskId || checkpoint.sourceKind !== input.sourceKind
      || checkpoint.sourceVersion !== input.sourceVersion || checkpoint.title !== input.title
      || checkpoint.body !== input.body || checkpoint.availability !== input.availability
      || checkpoint.unavailableReason !== input.unavailableReason) {
      throw new FindingCaptureError('conflict', `lifecycle boundary '${input.boundaryKey}' changed after capture`)
    }
    if (input.sourceKind === 'task-archive') await this.schedule(input)
    return this.checkpoint(input.boundaryKey)!
  }

  async reconcile(): Promise<void> {
    for (const checkpoint of this.options.db.select().from(findingLifecycleCheckpoints).all()) {
      if (checkpoint.sourceKind !== 'task-archive' || checkpoint.preparedBundleId) continue
      await this.schedule(this.toCheckpoint(checkpoint)).catch(() => undefined)
    }
    for (const task of await this.options.core.tasks.active()) {
      const agents = this.options.agents()
      if (agents) for (const ref of await agents.listCompleted(task.id)) await this.reconcileAgent(ref, agents)
      const workflows = this.options.workflows?.()
      if (workflows) for (const ref of await workflows.listCompleted(task.id)) await this.workflowCompleted(ref)
    }
  }

  async terminalCompleted(event: TerminalCompletedEvent): Promise<void> {
    const input = await this.options.terminal?.()?.read(event.taskId, event.sessionId)
    const body = input?.availability === 'available' ? input.output?.trim() ?? '' : ''
    await this.boundary({
      taskId: event.taskId, boundaryKey: `terminal:${event.sessionId}:exit`, sourceKind: 'terminal',
      sourceVersion: `exit:${event.exitCode ?? 'unknown'}`, title: `Agent terminal exited (${event.exitCode ?? 'unknown'})`,
      body: body || null, availability: body ? 'available' : 'unavailable',
      ...(body ? {} : { unavailableReason: input?.unavailableReason ?? 'Retained terminal output is unavailable.' }),
      completedAt: event.completedAt,
    })
  }

  async workflowCompleted(event: WorkflowCompletedEvent): Promise<void> {
    const input = await this.options.workflows?.()?.read(event.taskId, event.runId)
    const body = input?.availability === 'available' ? input.handoff?.trim() ?? '' : ''
    await this.boundary({
      taskId: event.taskId, boundaryKey: `workflow:${event.runId}:terminal`, sourceKind: 'workflow',
      sourceVersion: `terminal:${event.status}`, title: `Workflow ${event.status}`,
      body: body || null, availability: body ? 'available' : 'unavailable',
      ...(body ? {} : { unavailableReason: input?.unavailableReason ?? `The ${event.status} workflow produced no handoff note.` }),
      completedAt: event.completedAt,
    })
  }

  async archiveReview(input: { taskId: string; sessionIds: string[]; terminalOutput: string; diff: string }): Promise<void> {
    const evidence = [input.terminalOutput.trim(), input.diff.trim() ? `Uncommitted diff:\n${input.diff.trim()}` : null]
      .filter(Boolean).join('\n\n')
    const body = evidence
      ? [evidence, input.sessionIds.length ? `Terminal sessions: ${input.sessionIds.join(', ')}` : null].filter(Boolean).join('\n\n')
      : null
    await this.boundary({
      taskId: input.taskId, boundaryKey: `task:${input.taskId}:archive`, sourceKind: 'task-archive',
      sourceVersion: '1', title: 'Task archive requested', body,
      availability: body ? 'available' : 'unavailable',
      ...(body ? {} : { unavailableReason: 'No retained terminal output or readable worktree diff was available before teardown.' }),
      completedAt: this.options.now?.() ?? Date.now(),
    })
  }

  async bundlePublished(bundle: { id: string; boundaryKey: string; scope: { kind: string }; candidates: unknown[]; state: string }): Promise<void> {
    if (bundle.state !== 'ready' || bundle.scope.kind !== 'project' || bundle.candidates.length === 0) return
    const userId = this.options.core.identity.active()
    if (!userId || !(await this.settings(userId)).notifyWhenReady) return
    const claimed = this.options.db.insert(findingBundleNotices).values({ bundleId: bundle.id, emittedAt: this.options.now?.() ?? Date.now() }).onConflictDoNothing().run()
    if (!claimed.changes) return
    const taskId = this.options.db.select({ taskId: findingLifecycleCheckpoints.taskId })
      .from(findingLifecycleCheckpoints).where(eq(findingLifecycleCheckpoints.preparedBundleId, bundle.id)).get()?.taskId
      ?? /^manual:([^:]+):/.exec(bundle.boundaryKey)?.[1]
    try {
      this.options.notice({
        ...(taskId ? { taskId } : {}),
        title: `${bundle.candidates.length} review suggestion${bundle.candidates.length === 1 ? '' : 's'} ready`,
        kind: 'findings-review',
        target: { kind: 'findings-bundle', resourceId: bundle.id },
      })
    } catch (error) {
      this.options.db.delete(findingBundleNotices).where(eq(findingBundleNotices.bundleId, bundle.id)).run()
      throw error
    }
  }

  async prepareTask(taskId: string, boundaryKey: string, targetId: string): Promise<FindingBundle> {
    const userId = this.options.core.identity.active()
    if (!userId) throw new FindingCaptureError('forbidden', 'an active owner is required for review')
    const settings = await this.settings(userId)
    if (!settings.backendId) throw new FindingCaptureError('unavailable', 'Choose a review model in Settings before preparing suggestions.')
    return this.options.runtime.startPrepareTask(taskId, {
      boundaryKey,
      targetId,
      backendId: settings.backendId,
      ...(settings.modelId ? { modelId: settings.modelId } : {}),
    })
  }

  private async reconcileAgent(ref: AgentReviewInputRef, agents: AgentReviewInputCapability): Promise<void> {
    const boundaryKey = `agent:${ref.sessionId}:${ref.turnId}:${ref.attempt}:${ref.completedSequence}`
    if (this.checkpoint(boundaryKey)) return
    const input = await agents.read(ref)
    if (input.purpose === 'review') return
    if (input.purpose === 'workflow') {
      await this.boundary({
        taskId: ref.taskId, boundaryKey, sourceKind: 'agent', sourceVersion: String(ref.completedSequence),
        title: 'Workflow-managed turn checkpoint', body: null, availability: 'unavailable',
        unavailableReason: 'This turn belongs to its top-level workflow boundary.', completedAt: ref.completedAt,
      })
      return
    }
    const body = [input.assistantSummary, ...input.userMessages.map((message) => `User message:\n${message}`)].filter(Boolean).join('\n\n')
    await this.boundary({
      taskId: ref.taskId, boundaryKey, sourceKind: 'agent', sourceVersion: String(ref.completedSequence),
      title: 'Managed agent turn completed', body: body || null,
      availability: body ? 'available' : 'unavailable',
      ...(body ? {} : { unavailableReason: input.unavailableReason ?? 'No bounded review input was available.' }),
      completedAt: ref.completedAt,
    })
  }

  private async schedule(input: FindingsBoundaryInput): Promise<void> {
    const userId = this.options.core.identity.active()
    if (!userId) return
    const settings = await this.settings(userId)
    if (!settings.backendId || !settings.targetId || !this.options.runtime.hasReviewTarget(settings.targetId)) return
    const bundle = await this.options.runtime.startPrepareTask(input.taskId, {
      boundaryKey: input.boundaryKey,
      targetId: settings.targetId,
      backendId: settings.backendId,
      ...(settings.modelId ? { modelId: settings.modelId } : {}),
    })
    this.options.db.update(findingLifecycleCheckpoints)
      .set({ preparedBundleId: bundle.id, updatedAt: this.options.now?.() ?? Date.now() })
      .where(eq(findingLifecycleCheckpoints.boundaryKey, input.boundaryKey)).run()
  }

  private checkpoint(boundaryKey: string): FindingsLifecycleCheckpoint | null {
    const row = this.options.db.select().from(findingLifecycleCheckpoints).where(eq(findingLifecycleCheckpoints.boundaryKey, boundaryKey)).get()
    return row ? this.toCheckpoint(row) : null
  }

  private toCheckpoint(row: typeof findingLifecycleCheckpoints.$inferSelect): FindingsLifecycleCheckpoint {
    return {
      taskId: row.taskId,
      boundaryKey: row.boundaryKey,
      sourceKind: row.sourceKind as FindingsBoundaryInput['sourceKind'],
      sourceVersion: row.sourceVersion,
      title: row.title,
      body: row.body,
      availability: row.availability as FindingsBoundaryInput['availability'],
      ...(row.unavailableReason ? { unavailableReason: row.unavailableReason } : {}),
      completedAt: row.completedAt,
      observationId: row.observationId,
      preparedBundleId: row.preparedBundleId,
      updatedAt: row.updatedAt,
    }
  }

  private agentOrigin(input: FindingsBoundaryInput): FindingOrigin {
    const parts = /^agent:([^:]+):([^:]+):(\d+):/.exec(input.boundaryKey)
    return { kind: 'agent', sessionId: parts?.[1] ?? 'unavailable', turnId: parts?.[2], attempt: Number(parts?.[3] ?? 1) }
  }
}
