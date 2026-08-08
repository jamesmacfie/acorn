import type { BrowserDesktopCapability } from '@acorn/protocol/desktopCapabilities.ts'
import type { InternalEnvFactory } from '@acorn/node-core/server/auth/internalTokens.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { CapabilityRegistry } from '@acorn/node-core/server/plugin/capabilities.ts'
import { GITHUB_MIRROR } from '@acorn/plugin-github/contract/mirror.ts'
import { MEMORY_KNOWLEDGE } from '@acorn/plugin-memory/contract/knowledge.ts'
import type { NodePluginDeps } from './plugins'

// The plugin dependency bag, built once for both composition roots.
//
// It was written out twice — in service/runtime.ts and server/standalone.ts — and the only genuine
// difference between the copies is the preview browser: the Electron root has a real
// DesktopCapabilities peer, the headless one has a stub that rejects with a reason. Everything else
// was fifty lines of identical closures kept in step by hand, guarded by a parity test that scanned
// for five source strings and so could catch a REMOVED call but never a divergent argument.
//
// One function means the parity test no longer has to guess. It asserts the genuine deltas instead.
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
  // Resolved at CALL time, never here. Two reasons, and both are load-bearing: memory's init runs
  // inside initPlugins and has not happened when this object is built, and plugins/terminal cannot
  // import memory directly because plugins/memory already imports terminal's TERMINAL_SEND_TO_AGENT —
  // the edge back would close a package cycle that turbo refuses to build.
  //
  // Breaking that properly means inverting one half, the way plugins/agents and plugins/workflows were
  // (plugins/agents/src/contract/workflowControl.ts). Until then the root injects the thunks.
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
      // github's `repos` + `checks`, behind that plugin's own capability. Resolved at CALL time, never
      // at init: plugin init order is undefined, so reading it here could capture `undefined` purely
      // because github is declared after workflows in the list. `get`, not `require` — a node whose
      // github init failed should fail this one policy, not every step.
      failingChecks: async (taskId) =>
        (await capabilities.get(GITHUB_MIRROR)?.failingChecks(core.identity.active(), taskId)) ?? null,
    },
  }
}
