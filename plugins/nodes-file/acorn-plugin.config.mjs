// The loadable-package declaration for the reference node provider: what
// `apps/node/scripts/build-plugin.mjs` reads to build the bundle and generate `acorn-plugin.json`.
//
// Worth reading as a list of absences, because they are the point. No `client`, so no frame, no bundle
// hash, no trust prompt. No `contributions`, because a node provider is not a manifest-declared kind:
// it is registered through `ctx.providers.nodes`, like an integration provider, and the host qualifies
// its id. No `net`, because this one reads a local file — a real control-plane plugin would name its
// API host here. It has no core, secret, process, or network grants; its one explicit resource is the
// local inventory file configured by `ACORN_NODES_FILE`.
//
// The one file grant resolves its machine-specific path from the environment and is enforced by the
// isolated worker. If the first-party cloud plugin ever needs something this file cannot express, the
// seam is not finished.
export default {
  name: 'Nodes from a file',
  entry: '@acorn/plugin-nodes-file/node/index.ts',
  factory: 'nodesFilePlugin',
  permissions: {
    api: [],
    events: [],
    node: {
      core: [],
      capabilities: [],
      secrets: false,
      exec: false,
      net: [],
      files: [{ env: 'ACORN_NODES_FILE', access: 'read-write' }],
    },
  },
  contributions: {},
}
