// The code hosts each running plugin declares (docs/plugins/code-hosts.md). Filled by the host from a
// loaded manifest's `contributions.codeHost` or a built-in's `NodePlugin.codeHost`, and emptied with
// the plugin's other registrations. Core asks it which plugin owns the host a project's remote names.
import { codeHostDescriptor, type CodeHostDescriptor } from '@acorn/protocol/plugin/contract.ts'
import { createLogger } from '../telemetry/logger'

const log = createLogger('code-hosts')

const declared = new Map<string, { declaration: CodeHostDescriptor; builtin: boolean }>()

// Who holds a host two plugins claim, whatever order they registered in: a built-in beats a loaded
// plugin, so an installed package can't take github.com from GitHub, even across a reload. Between two
// of the same tier the lower plugin id wins.
const holders = () =>
  [...declared].sort(([a, x], [b, y]) => Number(y.builtin) - Number(x.builtin) || (a < b ? -1 : a > b ? 1 : 0))

/** Record what `pluginId` declares. Returns the undo for the plugin's registration list. A built-in is
 *  held to the manifest's schema here, so a bad declaration fails the boot. */
export function declareCodeHost(
  pluginId: string,
  descriptor: CodeHostDescriptor | undefined,
  builtin: boolean,
): () => void {
  if (!descriptor) return () => {}
  const entry = { declaration: codeHostDescriptor.parse(descriptor), builtin }
  declared.set(pluginId, entry)
  for (const host of entry.declaration.hosts) {
    const holder = codeHostFor(host)
    if (holder !== pluginId) log.warn(`'${pluginId}' claims ${host}, which '${holder}' holds and keeps`)
  }
  return () => {
    if (declared.get(pluginId) === entry) declared.delete(pluginId)
  }
}

/** The id of the running plugin that holds `host`, or null when none claims it. */
export function codeHostFor(host: string): string | null {
  return holders().find(([, { declaration }]) => declaration.hosts.includes(host))?.[0] ?? null
}

/** What the running plugin `provider` declared about its change requests, or undefined when it isn't
 *  running or declared none. */
export function changeRequestDeclaration(provider: string): CodeHostDescriptor['changeRequest'] {
  return declared.get(provider)?.declaration.changeRequest
}
