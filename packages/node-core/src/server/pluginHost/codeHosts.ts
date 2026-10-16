// The code hosts each running plugin declares (docs/plugins/code-hosts.md). Filled by the host from a
// loaded manifest's `contributions.codeHost` or a built-in's `NodePlugin.codeHost`, and emptied with
// the plugin's other registrations. Core asks it which plugin owns the host a project's remote names.
//
// A `selfHosted` code host also claims hosts while it runs, such as a company server a person connects.
// The claims live on the plugin's entry and nowhere else, so they go when the plugin stops, and the
// plugin claims them again when it starts.
import { codeHostDescriptor, codeHostName, type CodeHostDescriptor } from '@acorn/protocol/plugin/contract.ts'
import { createLogger } from '../telemetry/logger'

const log = createLogger('code-hosts')

type Entry = {
  declaration: CodeHostDescriptor
  builtin: boolean
  // Each claimed host, with the token of the claim that holds it, so an old release can't drop a newer
  // claim of the same host.
  claimed: Map<string, object>
}
const declared = new Map<string, Entry>()

const holdsHost = (entry: Entry, host: string): boolean =>
  entry.declaration.hosts.includes(host) || entry.claimed.has(host)

// Who holds a host two plugins claim, whatever order they registered or claimed in: a built-in beats a
// loaded plugin, so an installed package can't take github.com from GitHub, even across a reload.
// Between two of the same tier the lower plugin id wins.
const holders = () =>
  [...declared].sort(([a, x], [b, y]) => Number(y.builtin) - Number(x.builtin) || (a < b ? -1 : a > b ? 1 : 0))

const warnIfHeldElsewhere = (pluginId: string, host: string): void => {
  const holder = codeHostFor(host)
  if (holder !== pluginId) log.warn(`'${pluginId}' claims ${host}, which '${holder}' holds and keeps`)
}

/** Record what `pluginId` declares. Returns the undo for the plugin's registration list. A built-in is
 *  held to the manifest's schema here, so a bad declaration fails the boot. */
export function declareCodeHost(
  pluginId: string,
  descriptor: CodeHostDescriptor | undefined,
  builtin: boolean,
): () => void {
  if (!descriptor) return () => {}
  const entry: Entry = { declaration: codeHostDescriptor.parse(descriptor), builtin, claimed: new Map() }
  declared.set(pluginId, entry)
  for (const host of entry.declaration.hosts) warnIfHeldElsewhere(pluginId, host)
  return () => {
    if (declared.get(pluginId) === entry) declared.delete(pluginId)
  }
}

/** Claim `host` for the running plugin `pluginId`, under the same tie rules as a declared host. Throws
 *  for a plugin that didn't declare a `selfHosted` code host, or a host that isn't a bare lowercase
 *  name. Returns the release. */
export function claimCodeHost(pluginId: string, host: string): () => void {
  const entry = declared.get(pluginId)
  if (!entry?.declaration.selfHosted)
    throw new Error(`Plugin '${pluginId}' can't claim ${host}: its code host doesn't declare selfHosted.`)
  const parsed = codeHostName.safeParse(host)
  if (!parsed.success) throw new Error(`Plugin '${pluginId}' can't claim '${host}': a host is a bare lowercase name.`)
  const token = {}
  entry.claimed.set(host, token)
  warnIfHeldElsewhere(pluginId, host)
  return () => {
    if (entry.claimed.get(host) === token) entry.claimed.delete(host)
  }
}

/** The id of the running plugin that holds `host`, or null when none claims it. */
export function codeHostFor(host: string): string | null {
  return holders().find(([, entry]) => holdsHost(entry, host))?.[0] ?? null
}

/** The hosts the running plugin `pluginId` holds, declared and claimed, without those another plugin
 *  wins. Sorted. */
export function heldHosts(pluginId: string): string[] {
  const entry = declared.get(pluginId)
  if (!entry) return []
  return [...new Set([...entry.declaration.hosts, ...entry.claimed.keys()])]
    .filter((host) => codeHostFor(host) === pluginId)
    .sort()
}

/** What the running plugin `provider` declared about its change requests, or undefined when it isn't
 *  running or declared none. */
export function changeRequestDeclaration(provider: string): CodeHostDescriptor['changeRequest'] {
  return declared.get(provider)?.declaration.changeRequest
}

/** The name a person reads for the running plugin `pluginId`'s code host, or null when it declares none. */
export const codeHostLabel = (pluginId: string): string | null => declared.get(pluginId)?.declaration.label ?? null

/** The ids of the running plugins that declare a code host. */
export const runningCodeHosts = (): string[] => [...declared.keys()]
