// The browser handoffs and task address routes each running plugin declares, for the extension's
// discovery route (docs/plugin-authoring/browser-handoffs.md). Filled by the host from a loaded
// manifest's `contributions.browserHandoffs` and `contributions.taskAddresses`, or a built-in's
// `NodePlugin.browserHandoffs`, and emptied with the plugin's other registrations. A package waiting
// for review or a restart has no binding yet, so its declarations aren't here until it runs.
import { z } from 'zod'
import {
  browserHandoffDescriptor,
  type BrowserHandoff,
  type BrowserHandoffDescriptor,
  type TaskAddressesRoute,
} from '@acorn/protocol/plugin/handoffs.ts'

const declared = new Map<string, { handoffs: readonly BrowserHandoff[]; taskAddresses: string | undefined }>()

// Both tiers pass this, so a compiled declaration meets the rules a manifest does: the descriptor
// schema, a resolve route inside the plugin's own namespace, and IDs unique within the plugin. A loaded
// manifest was already held to them when it parsed; a built-in that breaks them fails the boot.
function validated(pluginId: string, descriptors: readonly BrowserHandoffDescriptor[]): BrowserHandoff[] {
  const parsed = z.array(browserHandoffDescriptor).max(4).parse(descriptors)
  const ownRoute = `/v1/p/${pluginId}/`
  const ids = new Set<string>()
  for (const handoff of parsed) {
    const url = new URL(handoff.resolve, 'https://acorn.invalid')
    if (
      !handoff.resolve.startsWith('/') ||
      url.origin !== 'https://acorn.invalid' ||
      !url.pathname.startsWith(ownRoute)
    )
      throw new Error(`browser handoff '${handoff.id}' resolves through '${handoff.resolve}', outside ${ownRoute}`)
    if (ids.has(handoff.id)) throw new Error(`duplicate browser handoff id '${handoff.id}'`)
    ids.add(handoff.id)
  }
  return parsed.map((handoff) => ({ ...handoff, pluginId }))
}

/** Record what `pluginId` declares. Returns the undo for the plugin's registration list. Only a loaded
 *  manifest declares `taskAddresses`, and its parse already confined the route to the plugin. */
export function declareBrowserHandoffs(
  pluginId: string,
  descriptors: readonly BrowserHandoffDescriptor[],
  taskAddresses?: string,
): () => void {
  const declaration = { handoffs: validated(pluginId, descriptors), taskAddresses }
  declared.set(pluginId, declaration)
  return () => {
    if (declared.get(pluginId) === declaration) declared.delete(pluginId)
  }
}

/** Every running plugin's handoffs, ordered by plugin and then declaration. */
export const browserHandoffs = (): BrowserHandoff[] =>
  [...declared.keys()].sort().flatMap((pluginId) => declared.get(pluginId)!.handoffs)

/** Every running plugin's task address route, ordered by plugin. */
export const taskAddressRoutes = (): TaskAddressesRoute[] =>
  [...declared.keys()].sort().flatMap((pluginId) => {
    const route = declared.get(pluginId)!.taskAddresses
    return route === undefined ? [] : [{ pluginId, route }]
  })
