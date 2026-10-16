// The browser handoffs, task address routes, and sidebar panels each running plugin declares, and its
// logo, for the extension's discovery route (docs/plugin-authoring/browser-handoffs.md). Filled by the
// host from a loaded manifest's `contributions.browserHandoffs`, `taskAddresses`, `browserPanel`, and
// `icon`, or a built-in's `NodePlugin.browserHandoffs` and `browserPanel`, and emptied with the plugin's
// other registrations. A package waiting
// for review or a restart has no binding yet, so its declarations aren't here until it runs.
import { z } from 'zod'
import {
  browserHandoffDescriptor,
  browserPanelDescriptor,
  type BrowserHandoff,
  type BrowserHandoffDescriptor,
  type BrowserPanel,
  type BrowserPanelDescriptor,
  type PluginIcon,
  type TaskAddressesRoute,
} from '@acorn/protocol/plugin/handoffs.ts'
import { expandCodeHostPattern } from '@acorn/protocol/contentLinkPattern.ts'
import { heldHosts } from './codeHosts'

type Declaration = {
  handoffs: readonly BrowserHandoff[]
  taskAddresses: string | undefined
  panel: BrowserPanelDescriptor | undefined
  icon: Omit<PluginIcon, 'pluginId'> | undefined
}
const declared = new Map<string, Declaration>()

const isOwnRoute = (pluginId: string, route: string): boolean => {
  const url = new URL(route, 'https://acorn.invalid')
  return (
    route.startsWith('/') && url.origin === 'https://acorn.invalid' && url.pathname.startsWith(`/v1/p/${pluginId}/`)
  )
}

// Both tiers pass this, so a compiled declaration meets the rules a manifest does: the descriptor
// schema, a resolve route inside the plugin's own namespace, and IDs unique within the plugin. A loaded
// manifest was already held to them when it parsed; a built-in that breaks them fails the boot.
function validated(pluginId: string, descriptors: readonly BrowserHandoffDescriptor[]): BrowserHandoff[] {
  const parsed = z.array(browserHandoffDescriptor).max(4).parse(descriptors)
  const ids = new Set<string>()
  for (const handoff of parsed) {
    if (!isOwnRoute(pluginId, handoff.resolve))
      throw new Error(
        `browser handoff '${handoff.id}' resolves through '${handoff.resolve}', outside /v1/p/${pluginId}/`,
      )
    if (ids.has(handoff.id)) throw new Error(`duplicate browser handoff id '${handoff.id}'`)
    ids.add(handoff.id)
  }
  return parsed.map((handoff) => ({ ...handoff, pluginId }))
}

// The same rules for a panel: the descriptor schema and a route inside the plugin's own namespace.
// Unlike a manifest's, a built-in's `pane` can't be checked here, because the Node half can't see its
// client panes; each plugin that declares a panel tests that instead.
function validatedPanel(
  pluginId: string,
  panel: BrowserPanelDescriptor | undefined,
): BrowserPanelDescriptor | undefined {
  if (panel === undefined) return undefined
  const parsed = browserPanelDescriptor.parse(panel)
  if (!isOwnRoute(pluginId, parsed.route))
    throw new Error(`browser panel route '${parsed.route}' is outside /v1/p/${pluginId}/`)
  return parsed
}

/** Record what `pluginId` declares. Returns the undo for the plugin's registration list. Only a loaded
 *  manifest declares `taskAddresses` and `icon`, and its parse already confined the route to the plugin
 *  and checked the logo. A panel comes from a loaded manifest or a built-in's `NodePlugin.browserPanel`. */
export function declareBrowserHandoffs(
  pluginId: string,
  descriptors: readonly BrowserHandoffDescriptor[],
  routes: {
    taskAddresses?: string
    browserPanel?: BrowserPanelDescriptor
    icon?: Omit<PluginIcon, 'pluginId'>
  } = {},
): () => void {
  const declaration = {
    handoffs: validated(pluginId, descriptors),
    taskAddresses: routes.taskAddresses,
    panel: validatedPanel(pluginId, routes.browserPanel),
    icon: routes.icon,
  }
  declared.set(pluginId, declaration)
  return () => {
    if (declared.get(pluginId) === declaration) declared.delete(pluginId)
  }
}

/** Every running plugin's handoffs, ordered by plugin and then declaration. A `{codeHost}` pattern is
 *  expanded here, on each read, into one pattern per host the plugin holds right now, so a host claimed
 *  or released since the plugin started is already in or out. A handoff left with no pattern is dropped. */
export const browserHandoffs = (): BrowserHandoff[] =>
  [...declared.keys()].sort().flatMap((pluginId) => {
    const hosts = heldHosts(pluginId)
    return declared.get(pluginId)!.handoffs.flatMap((handoff) => {
      const match = handoff.match.flatMap((pattern) => expandCodeHostPattern(pattern, hosts))
      return match.length ? [{ ...handoff, match }] : []
    })
  })

/** Every running plugin's task address route, ordered by plugin. */
export const taskAddressRoutes = (): TaskAddressesRoute[] =>
  [...declared.keys()].sort().flatMap((pluginId) => {
    const route = declared.get(pluginId)!.taskAddresses
    return route === undefined ? [] : [{ pluginId, route }]
  })

/** Every running plugin's sidebar panel, ordered by plugin. */
export const browserPanels = (): BrowserPanel[] =>
  [...declared.keys()].sort().flatMap((pluginId) => {
    const panel = declared.get(pluginId)!.panel
    return panel === undefined ? [] : [{ pluginId, ...panel }]
  })

/** The logo of every running plugin that declares a handoff or a panel and has one, ordered by plugin. */
export const browserIcons = (): PluginIcon[] =>
  [...declared.keys()].sort().flatMap((pluginId) => {
    const { handoffs, panel, icon } = declared.get(pluginId)!
    return icon && (handoffs.length || panel) ? [{ pluginId, ...icon }] : []
  })
