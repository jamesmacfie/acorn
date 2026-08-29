// Remote contributions: which sandboxed plugin draws a tree where.
//
// A plain registry keyed the way the frame registries are, because the resolution question is the
// same one: given a surface and a subject, whose bytes draw it? The difference is what registration
// carries — no component, just a bundle hash and the name of a renderer inside it.
import { Registry, type Disposable } from '../../registries/registry'
import type { PluginRemoteContribution } from '@acorn/protocol/pluginContract.ts'

export type RemoteContribution = {
  /** The namespaced contribution id (../contributionIds.ts). */
  id: string
  pluginId: string
  /** The bundle this device accepted. The worker runs these bytes and no others. */
  hash: string
  /** Which key of the object the bundle passed to `mountTree`. */
  entry: string
  /** `agentToolRenderer`: the tool names this draws. */
  tools: readonly string[]
}

export const remoteToolRendererRegistry = new Registry<RemoteContribution>('remote agent tool renderer')

/**
 * Whose tree draws this tool call, if anyone's.
 *
 * First match wins, which is the same rule the compiled `agentToolRendererRegistry` uses. Phase 4
 * replaces it with real arbitration; until then a second plugin claiming a tool name loses quietly
 * rather than the two fighting over the card.
 */
export const remoteToolRendererFor = (toolName: string): RemoteContribution | undefined =>
  remoteToolRendererRegistry.entries().find((entry) => entry.tools.includes(toolName))

/** Register one manifest row. The caller has already checked that the plugin is trusted on this
 *  device: a remote entry runs the plugin's bytes, so it is gated exactly as a frame is. */
export function registerRemote(pluginId: string, hash: string, row: PluginRemoteContribution): Disposable {
  const entry: RemoteContribution = { id: row.id, pluginId, hash, entry: row.entry, tools: row.tools ?? [] }
  switch (row.target) {
    case 'agentToolRenderer':
      return remoteToolRendererRegistry.register(entry)
  }
}
