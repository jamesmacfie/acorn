import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import type { NodeProviderContribution, NodeSpec, ProvidedNodeRecord } from '@acorn/plugin-api/node'
import { providedNodeStateSchema } from '@acorn/protocol/nodeProviders.ts'

// The reference node provider: nodes read out of a JSON file on the node's own disk.
//
// It exists because a seam with no consumer is a seam nobody has tried. Until the first-party cloud
// plugin exists, this is what exercises `ctx.providers.nodes`, `/v2/core/nodes`, adoption and the four
// lifecycle verbs, and it is what the tests run against. It is also the honest answer to "could
// someone else write one of these?": this package imports nothing but `@acorn/plugin-api`, `zod` and
// two protocol types, which is exactly what a stranger has.
//
// Inert unless `ACORN_NODES_FILE` is set. A reference implementation that started reading files on
// every install would be a surface nobody asked for, and pointing an environment variable at a file is
// the same shape of decision as `ACORN_CONTROL_PLANE_URL`.

const fileNodeSchema = z.object({
  // The provider's own handle. For a real control plane this is its database id; here it is whatever
  // the file says, and it is what every route and client row names this node by.
  providerNodeId: z.string().min(1),
  // acorn's id for the node, once it has one. Absent for a node that has not booted.
  nodeId: z.string().min(1).optional(),
  label: z.string().min(1),
  endpoint: z.string().url().optional(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  state: providedNodeStateSchema.default('ready'),
  // The node's own device token, as a control plane would have learned it at enrollment. Only the
  // adopt route ever sees it: the list route projects it out, and the projection is a field list
  // rather than a delete, so it cannot leak by omission.
  deviceToken: z.string().min(1).optional(),
})

const fileSchema = z.object({ nodes: z.array(fileNodeSchema).default([]) })
type FileNode = z.infer<typeof fileNodeSchema>

const toRecord = (node: FileNode): ProvidedNodeRecord => ({
  providerNodeId: node.providerNodeId,
  nodeId: node.nodeId ?? null,
  label: node.label,
  endpoint: node.endpoint ?? null,
  fingerprint: node.fingerprint ?? null,
  state: node.state,
  ...(node.deviceToken ? { enrollment: { deviceToken: node.deviceToken } } : {}),
})

const read = (path: string): FileNode[] => {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // A missing file is an empty inventory, not a failure. The alternative is a provider that reports
    // an error on every list until somebody creates a file, which reads as broken rather than empty.
    return []
  }
  const parsed = fileSchema.safeParse(JSON.parse(raw) as unknown)
  if (!parsed.success) throw new Error(`${path} is not a usable node list: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  return parsed.data.nodes
}

// Temp file then rename, so a crash mid-write cannot leave a truncated inventory behind. Same posture
// as the data root's own writes, for the same reason.
const write = (path: string, nodes: FileNode[]): void => {
  // The fixed sidecar is part of the manifest's exact read-write file grant. A pid-shaped name would
  // require granting the whole directory, which could expose unrelated files beside the inventory.
  const temporary = `${path}.acorn-tmp`
  writeFileSync(temporary, `${JSON.stringify({ nodes }, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

/** The provider, over one file path. Exported as a factory so the tests can point it at a temp file
 *  without an environment variable. */
export const nodesFileProvider = (path: string): NodeProviderContribution => ({
  id: 'file',
  label: 'Nodes from a file',
  list: async () => read(path).map(toRecord),
  // `create` obliges `destroy` — the registry refuses the pair otherwise, which is the DevPod rule the
  // contract borrows. Both are here, and `destroy` is the reason `create` is allowed to be.
  create: async (spec: NodeSpec) => {
    const nodes = read(path)
    // `provisioning`, with no endpoint. This provider builds nothing: it records the intent, and
    // whoever is standing up the machine fills in `endpoint`, `fingerprint` and `deviceToken`. That is
    // the honest shape for a file, and it is enough to exercise the state a real provider spends most
    // of its first minute in.
    const node: FileNode = {
      providerNodeId: `file-${randomUUID().slice(0, 8)}`,
      label: spec.label,
      state: 'provisioning',
    }
    write(path, [...nodes, node])
    return toRecord(node)
  },
  destroy: async (providerNodeId: string) => {
    write(path, read(path).filter((node) => node.providerNodeId !== providerNodeId))
  },
  start: async (providerNodeId: string) => setState(path, providerNodeId, 'ready'),
  stop: async (providerNodeId: string) => setState(path, providerNodeId, 'stopped'),
})

function setState(path: string, providerNodeId: string, state: FileNode['state']): void {
  const nodes = read(path)
  if (!nodes.some((node) => node.providerNodeId === providerNodeId)) {
    throw new Error(`${path} lists no node '${providerNodeId}'.`)
  }
  write(path, nodes.map((node) => (node.providerNodeId === providerNodeId ? { ...node, state } : node)))
}
