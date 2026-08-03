import { z } from 'zod'

// The vNext wire protocol version. Bumped on breaking change; the Node reports it at GET /v2/node
// and a client showing a major mismatch disables that node rather than negotiating capabilities
// (docs/vNext/protocol.md § Versioning). V1's cookie/`/api` transport was version 1.
export const NODE_PROTOCOL_VERSION = 2

// `node.json` in the data root: a Node's durable identity. Written once on first start and never
// rewritten except for `port`, which records the last successfully bound listener port so a restart
// usually lands back on the same one (docs/vNext/data.md).
export const nodeIdentitySchema = z.strictObject({
  nodeId: z.string().uuid(),
  createdAt: z.number().int().positive(),
  protocolVersion: z.number().int().positive(),
  // Absent until the first successful bind. 0 is never persisted — it means "pick an ephemeral port".
  port: z.number().int().min(1).max(65535).optional(),
})

export type NodeIdentity = z.infer<typeof nodeIdentitySchema>
