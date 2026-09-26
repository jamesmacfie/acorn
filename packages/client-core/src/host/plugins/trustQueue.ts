import { createSignal } from 'solid-js'
import type { NodePluginRow } from '@acorn/protocol/api.ts'
import type { BundleSource } from '@acorn/protocol/plugin/bundles.ts'
import type { PluginAckRecord } from '../../infra/platform'

// The shell can observe the queue without pulling installation and source resolution into its
// first-frame graph. Only the plugin distribution pass writes it.
export type PluginTrustRequest = {
  row: NodePluginRow
  hash: string
  nodeId: string
  source?: BundleSource
  sourceLabel?: string
  previous?: PluginAckRecord
}

export const [pendingTrust, setPendingTrust] = createSignal<readonly PluginTrustRequest[]>([])
