import { coreAttachmentRoute, type NodeAttachmentState } from '@acorn/protocol/api.ts'
import { readJson, sendJson } from '../apiClient'
import { createFleetQuery, type FleetResult } from './fanout'

// Which control plane each node is attached to, for Settings → Nodes (docs/node-enrollment.md).
//
// A fan-out rather than a read of the active node: attachment is a per-node fact, the settings page
// lists every node, and a node that cannot answer leaves its row without an attachment line instead of
// failing the page.
//
// Almost every node answers `{ attachment: null, error: null }`, which is what an install that nobody
// provisioned looks like, and the UI draws nothing for it.

const ATTACHMENT_KEY = ['node-attachment'] as const

export const createAttachments = () =>
  createFleetQuery<NodeAttachmentState>(
    () => ATTACHMENT_KEY,
    (nodeId, _dep, signal) => readJson<NodeAttachmentState>(coreAttachmentRoute, { nodeId, signal }),
  )

export const attachmentOf = (result: FleetResult<NodeAttachmentState>, nodeId: string): NodeAttachmentState | undefined =>
  result.rows.find((row) => row.nodeId === nodeId)?.data

/** Drop the attachment. The node revokes the control plane's device row and keeps working standalone,
 *  which is the promise the whole enrollment design rests on. */
export const detachNode = async (nodeId: string): Promise<void> => {
  await sendJson(coreAttachmentRoute, { method: 'DELETE', nodeId })
}
