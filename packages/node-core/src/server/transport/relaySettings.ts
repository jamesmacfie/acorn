import type { DataRoot } from '../storage/dataRoot'

// Which relay this Node dials out to, if any (docs/relay.md § The Node). The environment wins
// over node.json, as it does for the advertised host, and names both values or neither.
export type RelaySettings = { url: string; credential: string }

export function relaySettings(root: Pick<DataRoot, 'relay'>): RelaySettings | undefined {
  const url = process.env.ACORN_RELAY_URL?.trim()
  const credential = process.env.ACORN_RELAY_CREDENTIAL?.trim()
  const settings = url || credential ? { url, credential } : root.relay
  if (!settings) return undefined
  if (!settings.url || !settings.credential)
    throw new Error('Set both ACORN_RELAY_URL and ACORN_RELAY_CREDENTIAL, or neither.')
  // The same rule as relayRouteSchema's url, without loading the relay protocol on every boot.
  if (!/^wss?:\/\/[^/]/.test(settings.url) || !URL.canParse(settings.url))
    throw new Error(`The relay URL ${settings.url} must start with wss:// or ws://.`)
  return { url: settings.url, credential: settings.credential }
}
