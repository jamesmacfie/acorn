// What an installed plugin's manifest asks for, one key per grant, so a docs page can pair each with
// the reason in src/data/plugins.ts. The keys follow the manifest's own field names, such as
// `node.net:api.linear.app`, and the page shows them as they are.

type Permissions = {
  api?: string[]
  events?: string[]
  node?: {
    core?: string[]
    capabilities?: string[]
    secrets?: boolean
    exec?: boolean
    sockets?: boolean
    net?: string[]
    env?: string[]
    files?: { env: string; access: string }[]
  }
}

const NODE_FIELDS = ['core', 'capabilities', 'secrets', 'exec', 'sockets', 'net', 'env', 'files']

/** Every grant in a manifest's `permissions`, in the order the manifest declares them. */
export function permissionKeys(permissions: Permissions = {}): string[] {
  const node = permissions.node ?? {}
  // A field this list doesn't know would otherwise ask for something no page explains.
  const unknown = Object.keys(node).filter((field) => !NODE_FIELDS.includes(field))
  if (unknown.length) throw new Error(`Unknown node permission fields: ${unknown.join(', ')}`)
  return [
    ...(permissions.api ?? []).map((scope) => `api:${scope}`),
    ...(permissions.events ?? []).map((channel) => `events:${channel}`),
    ...(node.core ?? []).map((facet) => `node.core:${facet}`),
    ...(node.capabilities ?? []).map((id) => `node.capabilities:${id}`),
    ...(node.secrets ? ['node.secrets'] : []),
    ...(node.exec ? ['node.exec'] : []),
    ...(node.sockets ? ['node.sockets'] : []),
    ...(node.net ?? []).map((host) => `node.net:${host}`),
    ...(node.env ?? []).map((name) => `node.env:${name}`),
    ...(node.files ?? []).map((file) => `node.files:${file.env}:${file.access}`),
  ]
}
