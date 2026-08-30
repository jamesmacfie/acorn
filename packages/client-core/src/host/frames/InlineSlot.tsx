import { For, Show, createMemo } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { prefsOptions } from '../../infra/queries'
import { extensionPointRegistry } from '../registries/extensionPoints/extensionPoints'
import { activeNodeId } from '../../infra/node/activeNode'
import { eligiblePlugins } from '../plugins/contributions'
import { resolveSlot, slotChoiceFor, slotChoices } from '../tree/arbitration'
import PluginFrame from './PluginFrame'
import { frameBindingFor } from './register'

// Another plugin's rectangle, drawn as a sibling region of this one's pane (docs/plugins.md §
// Cooperative extension points, the `rectangle` kind).
//
// The counterpart to `tree/Slot.tsx`, and the same arbitration module decides both: what differs is
// what gets mounted. A remote slot grafts a tree of the host's own components; this places an iframe
// whose pixels belong to the contributor, for the surfaces that own pixels — Monaco, xterm, a canvas,
// a preview of arbitrary HTML.
//
// The two rectangles are siblings and the host sits between them. Neither can reach into the other:
// the occupant's bridge is bound from the occupant's own manifest, so standing inside somebody else's
// pane grants it nothing of theirs, and talking across the box is a hook with one handler
// (docs/plugins.md § Hooks).

export function InlineSlot(props: {
  /** `<owner>:<point>`, the id the host minted from the owner's manifest. */
  point: string
  /** What is in the box, for a `replace` point: usually the path or the mime type the owner is showing. */
  key?: string
  taskId?: string
  projectId?: string | null
}) {
  const prefs = createQuery(() => prefsOptions(true))

  const resolved = createMemo(() => {
    const point = extensionPointRegistry.get(props.point)
    if (!point || point.kind !== 'rectangle') return null
    const choices = slotChoices(prefs.data?.[PrefKeys.remoteSlots])
    return resolveSlot(point, props.key, slotChoiceFor(choices, props.point, props.key))
  })

  // How many the owner's own ceiling left out. Read here for the same reason `Slot` reads it: each
  // occupant of a rectangle point is a whole iframe, so `max` is a real limit and a point past it was
  // dropping contributors with nothing on screen to say so.
  const overflow = () => (resolved()?.why === 'match' ? resolved()!.overflow : 0)

  const occupants = createMemo(() => {
    const outcome = resolved()
    if (!outcome) return []
    // Each occupant is resolved back to its own plugin's roster row here rather than carried on the
    // registration, because the row holds the scopes, the event channels and the accepted bundle, and
    // all three are the contributor's own. An occupant whose plugin is no longer eligible on this node,
    // or whose bytes this device has not accepted, simply does not draw.
    return outcome.occupants.flatMap((entry) => {
      const owner = eligiblePlugins().find((candidate) => candidate.pluginId === entry.pluginId)
      const surface = owner?.installed.contributions.frames?.find((frame) => frame.id === entry.frame)
      // `trusted` is asked again here and not only at registration: a trust decision can be withdrawn
      // while a pane is open, and the box must empty rather than keep drawing bytes nobody accepts any
      // more.
      if (!owner?.trusted || !owner.hash || !surface || surface.target !== 'inline') return []
      return [{ entry, row: owner.row, surface, hash: owner.hash }]
    })
  })

  return (
    <Show when={occupants().length || overflow()}>
      <For each={occupants()}>
        {(occupant) => (
          <div class="inline-slot" data-plugin={occupant.entry.pluginId}>
            <PluginFrame
              binding={frameBindingFor(occupant.entry.pluginId, occupant.surface, occupant.row, {
                nodeId: activeNodeId() ?? '',
                ...(props.taskId ? { taskId: props.taskId } : {}),
                ...(props.projectId ? { projectId: props.projectId } : {}),
              })}
              hash={occupant.hash}
            />
          </div>
        )}
      </For>
      {/* A count and no names, exactly as the remote slot's disclosure does it: the owner set the
          ceiling because it is the owner's screen, and listing who was left out would be inviting a
          person to fix somebody else's arithmetic. */}
      <Show when={overflow()}>
        {(count) => <span class="muted">{count()} more from other plugins</span>}
      </Show>
    </Show>
  )
}
