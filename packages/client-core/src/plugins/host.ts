import { pluginCustody, type PluginHostState, type PluginPutResult, type PluginTrustDecision } from '../platform'

// The client's platform adapter for third-party plugin bundles
// (docs/plugins.md).
//
// Every other module in the client reaches the bundle cache and the trust store through this one
// file, never through the platform seam's `pluginCustody()` directly. That is the whole design: today it fronts
// Electron main's content-addressed store, and a future web client (docs/future/remote.md) fronts
// IndexedDB plus server-side per-user acknowledgements. The INTERFACE is the part that has to stay
// portable; the storage behind it is not, and letting the host object leak through client code would
// make the storage the contract by accident. `src/platform/` generalised this rule to the whole seam.
//
// Absent means "no host for third-party plugins here" — a browser build, or a test. Every caller
// treats that as "nothing installed", never as an error.

const bridge = pluginCustody

export const pluginHostAvailable = (): boolean => bridge() !== null

export const readPluginHostState = async (): Promise<PluginHostState> => {
  const host = bridge()
  if (!host) return { cached: {}, acks: [] }
  return host.state()
}

// Ask the host to fetch a plugin's client bundle from a node and cache it. The bytes never come back
// here — the answer is the hash the HOST computed from what arrived, which is the only hash anything
// in this system is allowed to trust.
export const cachePluginBundle = async (request: {
  nodeId: string
  pluginId: string
  hash: string
  version: string
}): Promise<PluginPutResult> => {
  const host = bridge()
  if (!host) return { error: 'unreachable' }
  return host.cachePut(request)
}

export const recordPluginTrust = async (decision: PluginTrustDecision): Promise<void> => {
  await bridge()?.trustRecord(decision)
}
