import { capabilityId } from '@acorn/plugin-api/node'

// agents.runtime: the post-listener reconcile pass, exactly as `workflows.runner` is.
//
// One method, not the runtime object, because reconcile() has to run after the listener binds (a resumed
// session's tools call the node's own loopback surface) and before the root resolves its `reconciled`
// promise. The sweep interrupts every active turn and expires every pending request, so anything started
// before it runs would be clobbered; that ordering belongs to the composition root, not to whoever calls
// this capability.
//
// Lives in contract/ so a composition root can import it as one of a plugin's public entrypoints
// (docs/architecture-overview.md § Package boundaries), rather than reaching past it into main/runtime.ts.
export const AGENTS_RUNTIME = capabilityId<{ reconcile(): Promise<void> }>('agents.runtime')
