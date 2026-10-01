import type { CoreServices } from '../core'

// Facet token to CoreServices key for grants that map one to one. `secrets` and `proc` are
// deliberately absent: their separate manifest booleans make those requests explicit. `git` is
// separate from `exec` even though both can run a subprocess, because reading history and running
// arbitrary commands are different requests to disclose.
//
// Keep this vocabulary independent of permission enforcement so manifest readers can validate
// packages without loading the Node's database service.
export const SIMPLE_FACETS = {
  fs: 'fs',
  git: 'git',
  context: 'context',
  models: 'models',
  identity: 'identity',
  'agent-tool-provenance': 'agentToolProvenance',
  // A sink can read every owner's records. Writing a plugin's own telemetry needs no grant.
  telemetry: 'telemetry',
} as const satisfies Record<string, keyof CoreServices>

// The whole `permissions.node.core` vocabulary. A facet added above lands here for free;
// pluginAuthoring.test.ts checks that each token still grants something.
export const NODE_CORE_FACETS = [
  ...Object.keys(SIMPLE_FACETS),
  'tasks',
  'data:query',
  'data:write',
  'prefs',
  'projects:read',
  'projects:config',
  'projects:write',
] as const
