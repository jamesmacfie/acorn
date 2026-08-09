import type { NodePluginPermissions } from '@acorn/protocol/api.ts'

// What a plugin's declared permissions read as in the trust prompt (PluginTrustDialog.tsx), in two
// groups that are NOT the same kind of promise.
//
// The `node` half describes what the plugin's server code says it will touch. Nothing checks it: that
// code shares the node's process and can import `node:fs` whatever its manifest claims. The `api` /
// `events` half is enforced — the UI bridge refuses anything undeclared (plugins/frames/scopes.ts).
// Rendering them as one list would let the strong half lend credibility to the weak one, which is
// exactly the thing docs/third-party/node-security.md § Design rules, rule 6 forbids.
//
// A plain module rather than exports on the dialog, so a node-env suite can import it: client-core's
// tests run under plain Node with no Solid plugin, and a .tsx does not parse there.
//
// The update prompt's "what is new" mark is set-difference over these strings, so the WORDING is the
// diff key — rephrasing a line without changing the grant would light it up as newly requested.

export const nodePermissionLines = (permissions: NodePluginPermissions): string[] => [
  ...(permissions.node.secrets ? ['Use your saved credentials to make requests on its behalf'] : []),
  ...(permissions.node.exec ? ['Run commands on the node'] : []),
  ...permissions.node.net.map((host) => `Reach ${host}`),
  // `core.projects` is not the modest-sounding grant it reads as: checkouts() returns the local
  // filesystem path of every codebase mapped on this machine (node-security.md § Rung 1).
  ...permissions.node.core.map((facet) =>
    facet.startsWith('projects') ? `core.${facet} — including where every codebase lives on disk` : `core.${facet}`,
  ),
  ...permissions.node.capabilities.map((id) => `capability ${id}`),
]

export const uiPermissionLines = (permissions: NodePluginPermissions): string[] => [
  ...permissions.api.map((route) => `api: ${route}`),
  ...permissions.events.map((event) => `events: ${event}`),
]
