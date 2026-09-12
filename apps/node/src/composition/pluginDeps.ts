import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import type { CoreServices } from '@acorn/node-core/server/core/index.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { AGENTS_REVIEW_INPUT, type AgentTurnChangedEvent } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { FINDINGS_LIFECYCLE, type FindingsBoundaryInput } from '@acorn/plugin-findings/contract/lifecycle.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { MEMORY_KNOWLEDGE } from '@acorn/plugin-memory/contract/knowledge.ts'
import type { NodePluginDeps } from './plugins'

// The plugin dependency bag, built once for both composition roots (docs/plugins.md § Adding a
// plugin contribution). Nothing in it differs between the two hosts.
export type PluginDepsInput = {
  capabilities: CapabilityRegistry
  core: CoreServices
  internalEnv: InternalEnvFactory
  // Resolves when the root's post-window reconcile pass is done (always resolves, even on failure).
  // terminal and workflows both await it before starting anything a sweep would clobber.
  reconciled: Promise<void>
}

export function buildPluginDeps({ capabilities, core, internalEnv, reconciled }: PluginDepsInput): NodePluginDeps {
  // Resolved at call time, never here. Memory's init runs inside initPlugins and has not happened yet
  // when this object is built, and plugins/terminal cannot import memory directly because
  // plugins/memory already imports terminal's TERMINAL_SEND_TO_AGENT. Importing back would close a
  // package cycle turbo refuses to build. See docs/plugins.md § Collaboration rules.
  //
  // The clean fix inverts one half, the way plugins/agents and plugins/workflows were
  // (plugins/agents/src/contract/workflowControl.ts). Until then the root injects these thunks.
  const knowledgeAt = () => capabilities.require(MEMORY_KNOWLEDGE)
  const findingsAt = async () => {
    const findings = capabilities.get(FINDINGS_LIFECYCLE)
    if (!findings) return null
    return (await findings.migrationReport()).cutoverReady ? findings : null
  }
  const legacyAgentReview = async (event: AgentTurnChangedEvent) => {
    const input = await capabilities.get(AGENTS_REVIEW_INPUT)?.read(event)
    if (!input || input.purpose !== 'ordinary') return
    const body = [
      input.assistantSummary,
      ...input.userMessages.map((message) => `User message:\n${message}`),
    ].filter(Boolean).join('\n\n')
    if (body) await knowledgeAt().memoryReviewTrigger(event.taskId, body)
  }
  const captureBoundary = async (input: FindingsBoundaryInput, legacyBody: string | null) => {
    const findings = await findingsAt()
    if (findings) {
      await findings.boundary(input)
      return
    }
    if (legacyBody?.trim()) await knowledgeAt().memoryReviewTrigger(input.taskId, legacyBody)
  }
  return {
    agents: {
      internalEnv,
      reconciled,
      // Findings consumes the durable agents event directly. This callback exists only for the
      // explicit absent/not-yet-safe migration fallback, so one turn never has two review owners.
      onCompletedTurn: async (event) => {
        if (await findingsAt()) return
        await legacyAgentReview(event)
      },
    },
    notes: { internalEnv },
    terminal: {
      internalEnv,
      launchInjector: (taskId, sessionId) => knowledgeAt().launchInjector(taskId, sessionId),
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
      reviewBoundary: async ({ taskId, sessionId, exitCode, transcriptTail }) => captureBoundary({
        taskId,
        boundaryKey: `terminal:${sessionId}:exit`,
        sourceKind: 'terminal',
        sourceVersion: `exit:${exitCode ?? 'unknown'}`,
        title: `Agent terminal exited (${exitCode ?? 'unknown'})`,
        body: transcriptTail.trim() || null,
        availability: transcriptTail.trim() ? 'available' : 'unavailable',
        ...(transcriptTail.trim() ? {} : { unavailableReason: 'The terminal had no retained output.' }),
        completedAt: Date.now(),
      }, transcriptTail),
      archiveReviewBoundary: async ({ taskId, transcriptTail }) => {
        const cwd = await core.tasks.root(taskId).catch(() => null)
        const diff = cwd
          ? await core.git.gitText(['diff', 'HEAD'], { cwd, timeoutMs: 15_000, maxOutputBytes: 12_000 }).catch(() => null)
          : null
        const body = [transcriptTail?.trim(), diff?.trim() ? `Uncommitted diff:\n${diff.trim()}` : null]
          .filter(Boolean).join('\n\n').slice(-16_000) || null
        await captureBoundary({
          taskId,
          boundaryKey: `task:${taskId}:archive`,
          sourceKind: 'task-archive',
          sourceVersion: '1',
          title: 'Task archive requested',
          body,
          availability: body ? 'available' : 'unavailable',
          ...(body ? {} : { unavailableReason: 'No retained terminal output or readable worktree diff was available before teardown.' }),
          completedAt: Date.now(),
        }, body)
      },
      reconciled,
    },
    workflows: {
      internalEnv,
      reconciled,
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
      reviewBoundary: async ({ taskId, runId, status, transcriptTail }) => captureBoundary({
        taskId,
        boundaryKey: `workflow:${runId}:terminal`,
        sourceKind: 'workflow',
        sourceVersion: `terminal:${status}`,
        title: `Workflow ${status}`,
        body: transcriptTail?.trim() || null,
        availability: transcriptTail?.trim() ? 'available' : 'unavailable',
        ...(transcriptTail?.trim() ? {} : { unavailableReason: `The ${status} workflow produced no handoff note.` }),
        completedAt: Date.now(),
      }, transcriptTail ?? `Workflow ${runId} ended with status ${status}.`),
      // github's `repos` + `checks`, behind its own capability, resolved at call time and never at
      // init: plugin init order is undefined, so reading it here could capture `undefined` only
      // because github is declared after workflows in the list. `get`, not `require`, so a node whose
      // github init failed fails this one policy, not every step.
      failingChecks: async (taskId) =>
        (await capabilities.get(GITHUB_MIRROR)?.failingChecks(core.identity.active(), taskId)) ?? null,
    },
  }
}
