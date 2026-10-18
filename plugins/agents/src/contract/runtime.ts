import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// agents.runtime: the post-listener reconcile pass, the same shape as `workflows.runner`.
//
// One method, not the runtime object. reconcile() has to run after the listener binds, because a
// resumed session's tools call the node's own loopback surface, and before the root resolves its
// `reconciled` promise. The sweep interrupts every active turn and expires every pending request, so
// that ordering belongs to the composition root.
//
// Lives in contract/ so a composition root imports it as one of the plugin's public entrypoints
// (docs/architecture/packages.md § Package boundaries) rather than reaching into the plugin's server half.
//
// `mark` is called after each step with the step's name, so the boot account can time them one by
// one (docs/telemetry/node-boot.md).
export const AGENTS_RUNTIME = capabilityId<{ reconcile(mark?: (step: string) => void): Promise<void> }>(
  'agents.runtime',
)
