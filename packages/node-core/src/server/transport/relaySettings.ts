import type { DataRoot } from '../storage/dataRoot'
import type { RelayState } from './relayTunnel'

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

// What the listener lets the account plugin do to a running Node's tunnel. `apply` waits until the
// change has happened. `state` is undefined while no tunnel runs.
export type RelayControl = {
  apply(settings: RelaySettings | undefined): Promise<void>
  state(): RelayState | undefined
}

// The account service this Node asks for its preview domain and DNS challenge, from `ACORN_ACCOUNT_URL`. It is
// the variable and the rule the sign-in plugin uses (plugins/account/src/server/config.ts), and a Node that
// turned Remote access on through that plugin has it set. The relay credential goes to it, so plain `http`
// is for a service on this computer only. Unset or not an address, there are no previews.
export function accountServiceUrl(): string | undefined {
  const text = process.env.ACORN_ACCOUNT_URL?.trim()
  if (!text || !URL.canParse(text)) return undefined
  const url = new URL(text)
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? url.origin : undefined
}
