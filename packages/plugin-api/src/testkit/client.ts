// The client half of the test seam: how a plugin's client-side tests reach the host.
//
// A sibling of ../testkit.ts rather than more exports on it. ../testkit.ts re-exports the node host, so
// the arch suite classifies it as node code, and a client import from there would cross the one
// boundary this repo does not let anything cross (`side` in tools/arch/boundaries.test.ts). The arch
// suite classifies this file as client by its name.
//
// Same two rules as its sibling: node-environment safe (no `.tsx`, nothing that touches `window`,
// since a barrel evaluates every module on it and plugin vitest configs are bare node), and test
// scaffolding rather than surface. The writer below stays off ./client, where plugins only ever read.

// The projects a content-link `path` resolver will see. Production code reads this list through
// `allProjects` and never writes it; the composition root installs the real reader. A test needs the
// writer, and reaching for it deep in client-core is what this entrypoint exists to stop.
export { setProjectsLookup } from '@acorn/client-core/features/projects/projectLookup.ts'
// The row shape those fixtures have to satisfy. A type, so it costs nothing at runtime, and it is the
// difference between a fixture that fails when `Project` changes and one that silently drifts.
export type { Project } from '@acorn/client-core/infra/queries.ts'

// The two registries a cooperative extension is registered through, for a test that renders one of
// its own plugin's slots and needs somebody on the other side of it (docs/plugins/cooperative-extension-points.md § Cooperative
// extension points). Production code never writes these — the chrome pass does, from a roster row —
// which is exactly why they belong here rather than on ./client.
export {
  extensionPointRegistry,
  extensionRegistry,
} from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
export type {
  ExtensionContribution,
  ExtensionPointContribution,
} from '@acorn/client-core/host/registries/extensionPoints/extensionPoints.ts'
// Hover and diagnostics providers by language, for an owner's test that needs one present. The chrome
// pass fills it from `contributions.documentServices` in production.
export { documentServiceRegistry } from '@acorn/client-core/host/registries/panes'
// What every registry hands back, so a suite can put its registrations away again.
export type { Disposable } from '@acorn/client-core/kit/lib'

// The writer behind `ctx.capabilities.provide`, for a test that renders a surface belonging to one
// plugin and needs another plugin on the other end of a capability. `clientCapability` is on ./client
// because plugins read capabilities in production; providing one outside `init` is test scaffolding,
// which is what this file is. It hands back a disposable, so a suite puts its provider away again.
export { provideClientCapability } from '@acorn/client-core/infra/node'

// A tree driven offline: the root `solidTree` renders into, with the mutations it emits handed to the
// test. This is how a pane test sees exactly what the sandbox would post, with no worker and no host on
// the other side. Production code never builds one; the SDK's `mountTree` does, per slot.
export { createRemoteRoot } from '@acorn/client-core/host/frames/remoteRoot.ts'
export type { RemoteRoot } from '@acorn/client-core/host/frames/remoteRoot.ts'

// Client host state used by plugin tests.
export {
  contentLinkRegistry,
  openInAppUrl,
  parseInAppTarget,
  activeRefPanel,
  closeRefPanel,
  refPanelRegistry,
} from '@acorn/client-core/host/registries/panes'
export { paneRegistry } from '@acorn/client-core/host/registries/panes/panes.ts'
// Pane tests invoke the commands their mounted pane registered through the real host registry.
export { commandRegistry } from '@acorn/client-core/host/registries/commands'
export { evictScope } from '@acorn/client-core/host/registries/shell'
export { setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
export { setActiveTaskId, setFocusedPane } from '@acorn/client-core/features/tasks/tasks.ts'
export { isDarkColor } from '@acorn/client-core/kit/tokens'

// Node-qualified client ownership fixtures populate the real fleet/status projection.
export { refreshFleet } from '@acorn/client-core/infra/node/fleet.ts'
