import { capabilityId } from '@acorn/protocol/pluginIds.ts'

// agents.runtime: the post-listener reconcile pass, the same shape as `workflows.runner`.
//
// One method, not the runtime object. reconcile() has to run after the listener binds, because a
// resumed session's tools call the node's own loopback surface, and before the root resolves its
// `reconciled` promise. The sweep interrupts every active turn and expires every pending request, so
// that ordering belongs to the composition root.
//
// Lives in contract/ so a composition root imports it as one of the plugin's public entrypoints
// (docs/architecture-overview.md § Package boundaries) rather than reaching into server/sessions/runtime.ts.
export const AGENTS_RUNTIME = capabilityId<{ reconcile(): Promise<void> }>('agents.runtime')
