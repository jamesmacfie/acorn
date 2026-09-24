import type { InternalEnvFactory } from '@acorn/node-core/server/auth'
import type { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import type { NodePluginDeps } from './plugins'
import { SCHEDULER } from '@acorn/node-core/server/schedules/index.ts'

// Runtime adapters shared by the desktop and standalone Node composition roots.
export type PluginDepsInput = {
  capabilities: CapabilityRegistry
  internalEnv: InternalEnvFactory
  // Resolves when the root's post-window reconcile pass is done (always resolves, even on failure).
  // terminal and workflows both await it before starting anything a sweep would clobber.
  reconciled: Promise<void>
}

export function buildPluginDeps({ capabilities, internalEnv, reconciled }: PluginDepsInput): NodePluginDeps {
  return {
    agents: {
      internalEnv,
      reconciled,
    },
    notes: { internalEnv },
    terminal: {
      internalEnv,
      reconciled,
    },
    workflows: {
      internalEnv,
      reconciled,
      scheduler: () => capabilities.require(SCHEDULER),
    },
  }
}
