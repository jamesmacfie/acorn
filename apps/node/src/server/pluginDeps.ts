import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'
import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { MEMORY_KNOWLEDGE } from '@acorn/plugin-memory/contract/knowledge.ts'
import type { NodePluginDeps } from './plugins'

// The plugin dependency bag, built once for both composition roots (docs/plugins.md § Adding a
// plugin contribution). The only real difference between the two hosts is the preview browser: the
// Electron root has a real DesktopCapabilities peer, the headless one a stub that rejects with a
// reason.
export type PluginDepsInput = {
  capabilities: CapabilityRegistry
  core: CoreServices
  internalEnv: InternalEnvFactory
  // Resolves when the root's post-window reconcile pass is done (always resolves, even on failure).
  // terminal and workflows both await it before starting anything a sweep would clobber.
  reconciled: Promise<void>
  // The one real difference between the roots.
  browser: BrowserDesktopCapability
}

export function buildPluginDeps({ capabilities, core, internalEnv, reconciled, browser }: PluginDepsInput): NodePluginDeps {
  // Resolved at call time, never here: memory's init runs inside initPlugins and has not happened yet
  // when this object is built, and plugins/terminal cannot import memory directly because
  // plugins/memory already imports terminal's TERMINAL_SEND_TO_AGENT. Importing back would close a
  // package cycle turbo refuses to build (docs/plugins.md § Collaboration rules describes the same
  // pattern for agents/workflows).
  //
  // The clean fix inverts one half, the way plugins/agents and plugins/workflows were
  // (plugins/agents/src/contract/workflowControl.ts). Until then the root injects these thunks.
  const knowledgeAt = () => capabilities.require(MEMORY_KNOWLEDGE)
  return {
    agents: {
      internalEnv,
      memoryReviewTrigger: (taskId, transcriptTail) => knowledgeAt().memoryReviewTrigger(taskId, transcriptTail),
    },
    // The browser driver behind the six `browser_*` tools preview owns. A native adapter, so it comes
    // from the root: a plugin may not import electron to build one.
    preview: { browser },
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
