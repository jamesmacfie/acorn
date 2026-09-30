import { coreStorageRoute, type NodeStorageReport } from '@acorn/protocol/api.ts'
import { readJson } from './apiClient'

// Settings > Storage and memory's core read, addressed at a named node. A plain function rather than
// a query, for the reason nodeSecurity.ts gives: nothing else reads it, and the page polls it itself.
export function nodeStorageReport(nodeId?: string): Promise<NodeStorageReport> {
  return readJson<NodeStorageReport>(coreStorageRoute, nodeId ? { nodeId } : {})
}
