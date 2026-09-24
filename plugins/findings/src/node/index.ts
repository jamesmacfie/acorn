import type { NodePlugin } from '@acorn/plugin-api/node'
import { FINDINGS_KIND, FINDINGS_PRODUCER, FINDINGS_REVIEW_TARGET } from '../contract/extensions'
import { FINDINGS_RECORDS } from '../contract/records'
import { FINDINGS_REVIEW, FINDINGS_AGENT_PROPOSAL } from '../contract/review'
import { FINDINGS_LIFECYCLE } from '../contract/lifecycle'
import { AGENTS_REVIEW_INPUT, type AgentTurnChangedEvent } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { AGENTS_SESSIONS } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { TERMINAL_REVIEW_INPUT, type TerminalCompletedEvent } from '@acorn/plugin-terminal/contract/reviewInput.ts'
import { WORKFLOW_REVIEW_INPUT, type WorkflowCompletedEvent } from '@acorn/plugin-workflows/contract/reviewInput.ts'
import { FindingCapture } from '../server/capture'
import { FindingsRuntime } from '../server/runtime'
import { FindingsReviewStore } from '../server/reviewStore'
import { FindingsLifecycle } from '../server/lifecycle'
import { exportFindings } from '../server/export'
import { createFindingsFetch } from '../server/routes'

export const findingsPlugin = (): NodePlugin => {
  let runtime: FindingsRuntime | null = null
  let lifecycle: FindingsLifecycle | null = null
  let lifecycleSubscription: { dispose(): void } | null = null
  let terminalSubscription: { dispose(): void } | null = null
  let workflowSubscription: { dispose(): void } | null = null
  let pluginSubscription: { dispose(): void } | null = null
  return {
    name: 'findings',
    init: (ctx) => {
      ctx.extensionPoints.declare(FINDINGS_KIND, 'Finding kinds')
      ctx.extensionPoints.declare(FINDINGS_PRODUCER, 'Finding producers')
      ctx.extensionPoints.declare(FINDINGS_REVIEW_TARGET, 'Finding review targets')
      ctx.extensionPoints.handle(FINDINGS_KIND, {
        id: 'observation',
        value: { version: 1, label: 'Observation' },
      })
      ctx.extensionPoints.handle(FINDINGS_KIND, {
        id: 'review-input',
        value: { version: 1, label: 'Review input' },
      })

      const db = ctx.storage.open()
      const capture = new FindingCapture({
        db,
        core: ctx.core,
        kinds: () => ctx.extensionPoints.handlers(FINDINGS_KIND).map((entry) => ({ id: entry.id, descriptor: entry.value })),
      })
      runtime = new FindingsRuntime({
        capture,
        emit: (frame) => ctx.events.send(frame),
        producerEntries: () => ctx.extensionPoints.handlers(FINDINGS_PRODUCER),
        targetEntries: () => ctx.extensionPoints.handlers(FINDINGS_REVIEW_TARGET),
        review: new FindingsReviewStore(db),
        core: ctx.core,
      })
      lifecycle = new FindingsLifecycle({
        db,
        runtime,
        core: ctx.core,
        agents: () => ctx.capabilities.get(AGENTS_REVIEW_INPUT),
        terminal: () => ctx.capabilities.get(TERMINAL_REVIEW_INPUT),
        workflows: () => ctx.capabilities.get(WORKFLOW_REVIEW_INPUT),
        notice: (notice) => ctx.events.notice(notice),
        settingsChanged: () => ctx.events.send({ channel: 'plugin:findings:settings-changed' }),
      })
      runtime.onBundlePublished((bundle) => lifecycle!.bundlePublished(bundle))
      lifecycleSubscription = ctx.events.on('plugin:agents:turn-changed', (frame) => {
        const event = frame as { channel: string } & AgentTurnChangedEvent
        if (event.status !== 'completed') return
        const reviewInput = ctx.capabilities.get(AGENTS_REVIEW_INPUT)
        if (!reviewInput) return
        void reviewInput.read(event).then((input) => {
          // Review turns consume observations; feeding their output back as another observation
          // would make review recursively review itself.
          if (input.purpose === 'review') return
          const body = [input.assistantSummary, ...input.userMessages.map((value) => `User message:\n${value}`)].filter(Boolean).join('\n\n')
          return lifecycle?.boundary({
            taskId: event.taskId,
            boundaryKey: `agent:${event.sessionId}:${event.turnId}:${event.attempt}:${input.completedSequence}`,
            sourceKind: 'agent',
            sourceVersion: String(input.completedSequence),
            title: input.purpose === 'workflow' ? 'Workflow-managed turn checkpoint' : 'Managed agent turn completed',
            body: input.purpose === 'ordinary' && body ? body : null,
            availability: input.purpose === 'ordinary' && body ? 'available' : 'unavailable',
            unavailableReason: input.purpose === 'workflow' ? 'This turn belongs to its top-level workflow boundary.' : input.unavailableReason ?? undefined,
            completedAt: input.completedAt,
          })
        }).catch((error: unknown) => ctx.log.warn(`managed-turn reconciliation failed: ${error instanceof Error ? error.message : String(error)}`))
      })
      terminalSubscription = ctx.events.on('plugin:terminal:completed', (frame) => {
        void lifecycle?.terminalCompleted(frame as unknown as TerminalCompletedEvent)
          .catch((error: unknown) => ctx.log.warn(`terminal completion capture failed: ${error instanceof Error ? error.message : String(error)}`))
      })
      workflowSubscription = ctx.events.on('plugin:workflows:completed', (frame) => {
        void lifecycle?.workflowCompleted(frame as unknown as WorkflowCompletedEvent)
          .catch((error: unknown) => ctx.log.warn(`workflow completion capture failed: ${error instanceof Error ? error.message : String(error)}`))
      })
      pluginSubscription = ctx.events.on('plugins:changed', () => runtime?.refreshContributors())
      ctx.capabilities.provide(FINDINGS_RECORDS, {
        listTask: (taskId, options) => runtime!.listTask(taskId, options),
        getTask: async (taskId, observationId) => runtime!.getTask(taskId, observationId),
      })
      ctx.capabilities.provide(FINDINGS_REVIEW, {
        candidate: async (candidateId, revision) => runtime!.candidate(candidateId, revision),
        bundles: async (scope, includeHistory) => runtime!.bundles(scope, includeHistory),
        observations: async (ids) => runtime!.observations(ids),
      })
      ctx.capabilities.provide(FINDINGS_AGENT_PROPOSAL, {
        submit: (input) => runtime!.submitAgentProposal(input, async (taskId, sessionId, proof) => {
          if (!(await ctx.core.agentToolProvenance?.verify({ taskId, sessionId, tool: 'memory_write', proof }))) return false
          const sessions = await ctx.capabilities.get(AGENTS_SESSIONS)?.list(taskId)
          return !!sessions?.some((session) => session.sessionId === sessionId && session.taskId === taskId)
        }),
      })
      ctx.capabilities.provide(FINDINGS_LIFECYCLE, {
        boundary: (input) => lifecycle!.boundary(input),
        reconcile: () => lifecycle!.reconcile(),
        settings: (userId) => lifecycle!.settings(userId),
        setSettings: (userId, settings) => lifecycle!.setSettings(userId, settings),
        export: async () => exportFindings(db),
      })
      ctx.routes.fetch(createFindingsFetch(runtime, lifecycle, () => exportFindings(db)), {
        prefix: '',
        note: 'device-owned findings plus host-dispatched task tools and bounded context',
      })
    },
    // The ready pass sees contributors independent of init order. Each writer still checks the live
    // extension entry on every call, so unloading its producer revokes a stale closure immediately.
    ready: async () => {
      runtime?.refreshContributors()
      await lifecycle?.reconcile()
    },
    dispose: () => {
      runtime?.dispose()
      lifecycleSubscription?.dispose()
      terminalSubscription?.dispose()
      workflowSubscription?.dispose()
      pluginSubscription?.dispose()
      lifecycleSubscription = null
      terminalSubscription = null
      workflowSubscription = null
      pluginSubscription = null
      lifecycle = null
      runtime = null
    },
  }
}
