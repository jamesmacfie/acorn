import { Hono } from 'hono'
import type { NodeAttachmentState } from '@acorn/protocol/api.ts'
import { readNodeAttachment, recordNodeAttachment } from '../storage/dataRoot'
import { auditActor, auditRequest } from '../auditRequest'
import type { AppEnv } from '../middleware/auth'
import { respondError } from '../respond'

// Settings → Nodes: who this node is attached to, and the button that drops it
// (docs/node-enrollment.md § Detaching).
//
// Gated with requireDevice by mount in server/index.ts, alongside devices and plugins. Both halves
// need it: the read names a control plane and its device row, which is reconnaissance, and the write
// revokes a credential.
//
// There is no attach route, and that is not an omission. Attaching happens once, at first boot, from
// the environment the provisioner set (server/enrollment.ts). An HTTP attach would be a way to hand a
// stranger a durable credential for this node with one request, which is precisely the thing the
// single-use enrollment token exists to bound.

export const attachment = new Hono<AppEnv>()
  .get('/', (c) => {
    const record = readNodeAttachment(c.env.DATA_DIR)
    return c.json({
      attachment: record.attachment ?? null,
      error: record.enrollmentError ?? null,
    } satisfies NodeAttachmentState)
  })
  // Detach. Revokes the device row the control plane holds, forgets the record, and leaves a node that
  // works exactly as it did before it ever enrolled. That last part is the promise this route is here
  // to keep, so nothing else about the node is touched.
  .delete('/', async (c) => {
    const { attachment: record } = readNodeAttachment(c.env.DATA_DIR)
    if (!record) return respondError(c, 404, 'not_found', ['This node is not attached to a control plane.'])
    // Revoke first. If this throws, the record stays and the owner can try again; the other order
    // would leave a live credential nobody can see, which is the one outcome worth avoiding.
    await c.env.DEVICES.revoke(record.deviceId, auditActor(c))
    recordNodeAttachment(c.env.DATA_DIR, undefined)
    auditRequest(c, {
      action: 'node.detached',
      subject: record.deviceId,
      details: { controlPlaneUrl: record.controlPlaneUrl, enrollmentTokenId: record.enrollmentTokenId },
    })
    return c.body(null, 204)
  })
