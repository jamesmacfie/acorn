import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'

// agents.runtime — the post-listener reconcile pass, exactly as `workflows.runner` is.
//
// One method, not the runtime object. reconcile() has to run after the listener binds (a resumed
// session's tools call the node's own loopback surface) and before the root resolves its `reconciled`
// promise, because the sweep interrupts every active turn and expires every pending request — anything
// started before it would be clobbered. That ordering is the composition root's to own; publishing the
// whole runtime would let it own rather more than that.
//
// In contract/ so the composition roots reach it through a plugin's declared surface instead of deep
// -importing main/runtime.ts. Its previous home argued that contract/ was for "the surface ANOTHER
// PLUGIN may import" — true, and the roots are not plugins, but the alternative was an app reaching
// past every entrypoint into an internal module, which is the thing the entrypoint rule now forbids.
// No plugin has any business sweeping this one's unsettled sessions; that is a convention, and the
// file's location was never what enforced it.
export const AGENTS_RUNTIME = capabilityId<{ reconcile(): Promise<void> }>('agents.runtime')
