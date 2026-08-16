// The CLIENT half of the test seam: how a plugin's client-side tests reach the host.
//
// A sibling of ./index.ts rather than more exports on it, and the split is the same one the production
// entrypoints make one directory over. ./index.ts re-exports the node host — context assembly, a real
// SQLite database, core's tables — so the arch suite classifies it as node code and a client import from
// there would cross the one boundary this repo does not let anything cross. This file is classified as
// client for the same reason ./client/index.ts is (tools/arch/boundaries.test.ts § side).
//
// Same two rules as its sibling. NODE-ENVIRONMENT SAFE: plugin vitest configs are bare node with no Solid
// transform, and a barrel evaluates every module on it, so nothing here may be a `.tsx` or touch `window`.
// And TEST SCAFFOLDING, NOT SURFACE: the writer below is deliberately absent from ./client, where plugins
// only ever read.

// The projects a content-link `path` resolver will see. Production code reads this list through
// `allProjects` and never writes it — the composition root installs the real reader — so a test needs the
// writer, and reaching for it deep in client-core is what this entrypoint exists to stop.
export { setProjectsLookup } from '@acorn/client-core/projects/projectLookup.ts'
// The row shape those fixtures have to satisfy. A type, so it costs nothing at runtime, and it is the
// difference between a fixture that fails when `Project` changes and one that silently drifts.
export type { Project } from '@acorn/client-core/queries.ts'
