// The client half of the test seam: how a plugin's client-side tests reach the host.
//
// A sibling of ./index.ts rather than more exports on it. ./index.ts re-exports the node host, so
// the arch suite classifies it as node code, and a client import from there would cross the one
// boundary this repo does not let anything cross (tools/arch/boundaries.test.ts § side). This file
// is classified as client for the same reason ./client/index.ts is.
//
// Same two rules as its sibling: node-environment safe (no `.tsx`, nothing that touches `window`,
// since a barrel evaluates every module on it and plugin vitest configs are bare node), and test
// scaffolding rather than surface. The writer below stays off ./client, where plugins only ever read.

// The projects a content-link `path` resolver will see. Production code reads this list through
// `allProjects` and never writes it; the composition root installs the real reader. A test needs the
// writer, and reaching for it deep in client-core is what this entrypoint exists to stop.
export { setProjectsLookup } from '@acorn/client-core/projects/projectLookup.ts'
// The row shape those fixtures have to satisfy. A type, so it costs nothing at runtime, and it is the
// difference between a fixture that fails when `Project` changes and one that silently drifts.
export type { Project } from '@acorn/client-core/queries.ts'

// The two registries a cooperative extension is registered through, for a test that renders one of
// its own plugin's slots and needs somebody on the other side of it (docs/plugins.md § Cooperative
// extension points). Production code never writes these — the chrome pass does, from a roster row —
// which is exactly why they belong here rather than on ./client.
export { extensionPointRegistry, extensionRegistry } from '@acorn/client-core/registries/extensionPoints.ts'
export type { ExtensionContribution, ExtensionPointContribution } from '@acorn/client-core/registries/extensionPoints.ts'
// What every registry hands back, so a suite can put its registrations away again.
export type { Disposable } from '@acorn/client-core/registries/registry.ts'
