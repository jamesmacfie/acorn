import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import type { CoreServices } from '@acorn/node-core/server/core/index.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
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
  return {
    agents: {
      internalEnv,
      reconciled,
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
    },
    notes: { internalEnv },
    terminal: {
      internalEnv,
      launchInjector: (taskId, sessionId) => knowledgeAt().launchInjector(taskId, sessionId),
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
      reconciled,
    },
    workflows: {
      internalEnv,
      reconciled,
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
      // github's `repos` + `checks`, behind its own capability, resolved at call time and never at
      // init: plugin init order is undefined, so reading it here could capture `undefined` only
      // because github is declared after workflows in the list. `get`, not `require`, so a node whose
      // github init failed fails this one policy, not every step.
      failingChecks: async (taskId) =>
        (await capabilities.get(GITHUB_MIRROR)?.failingChecks(core.identity.active(), taskId)) ?? null,
    },
  }
}
