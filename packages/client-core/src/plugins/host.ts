import { acornGlobal, type PluginHostState, type PluginPutResult, type PluginTrustDecision } from '../capabilities'

// The client's platform adapter for third-party plugin bundles
// (docs/third-party/phase-2-distribution-trust.md § Future-web note).
//
// Every other module in the client reaches the bundle cache and the trust store through this one
// file, never through `acornGlobal()?.plugins` directly. That is the whole design: today it fronts
// Electron main's content-addressed store, and a future web client (docs/future/remote.md) fronts
// IndexedDB plus server-side per-user acknowledgements. The INTERFACE is the part that has to stay
// portable; the storage behind it is not, and sprinkling `window.acorn.*` through client code would
// make the storage the contract by accident.
//
// Absent means "no host for third-party plugins here" — a browser build, or a test. Every caller
// treats that as "nothing installed", never as an error.

const bridge = () => acornGlobal()?.plugins

export const pluginHostAvailable = (): boolean => bridge() !== undefined

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
