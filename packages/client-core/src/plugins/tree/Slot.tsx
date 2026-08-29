import { For, Show, createMemo, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { PrefKeys } from '../../persistence/prefKeys'
import { prefsOptions } from '../../queries'
import { extensionPointRegistry } from '../../registries/extensionPoints'
import { RemoteTree } from './RemoteTree'
import { resolveSlot, slotChoiceFor, slotChoices } from './arbitration'

// A place in one plugin's tree where another plugin's tree may be grafted (docs/plugins.md §
// Cooperative extension points, the `remote` kind).
//
// The counterpart to ExclusiveSlotHost.tsx one directory up, and the same division of labour: the
// arbitration rule is in a JSX-free module with a test (./arbitration.ts) and this file is a `<For>`
// over the answer. What differs is who is being replaced. An exclusive slot is a plugin standing in
// for core; this is a plugin standing in a space another plugin reserved, and it exists in `stack` as
// well as `replace`, because "everyone who has something to add" is a real answer for a toolbar and
// never is for a task list.
//
// Two render paths, one node. A compiled plugin's contribution is a component in this process and is
// mounted here; a loaded plugin's is a bundle in a worker and goes through RemoteTree. The owner writes
// the same `Slot` either way and cannot tell which answered, which is the whole reason first-party and
// third-party share a component API (docs/future/layout/README.md, the first decision).
//
// Neither plugin sees the other's nodes. The contributor's code has exactly the permissions its own
// manifest declared: sitting inside somebody else's pane grants it nothing of theirs.
//
// Slots are one level, and nothing here enforces it because nothing has to: a contributor's tree is a
// stream of kit node names (@acorn/protocol/tree/nodes.ts), `Slot` is not one of them, and so a grafted
// subtree has no way to open a slot of its own. See docs/future/layout/refused.md for why nesting was
// refused rather than left to a runtime guard — it turns "who draws this" into a graph nobody can
// answer at trust time.

export type SlotProps = {
  /** `<owner>:<point>`, the id the host minted from the owner's manifest. */
  point: string
  /** What is in the box, for a `replace` point: a mime type, a path, a tool name. Absent in a `stack`
   *  point, where every contributor that declared no `matches` is in. */
  key?: string
  /** What the contributor's tree is mounted with. The owner's own data, in the owner's words; the host
   *  does not add to it. */
  props?: () => unknown
  /** Drawn when nobody matches, and when two match a `replace` point and nobody has picked. The owner's
   *  own answer to "what if nothing is here", which is why it is children rather than a prop: it is
   *  ordinary tree. */
  children?: JSX.Element
}

export function Slot(props: SlotProps) {
  const prefs = createQuery(() => prefsOptions(true))

  const resolved = createMemo(() => {
    const point = extensionPointRegistry.get(props.point)
    // A point nobody declared, or one whose owner is not running here, has nothing to deliver into.
    // Silent, like every other unmatched contribution; the developer view is where an author finds out.
    if (!point || point.kind !== 'remote') return null
    const choices = slotChoices(prefs.data?.[PrefKeys.remoteSlots])
    return { mode: point.mode ?? 'stack', outcome: resolveSlot(point, props.key, slotChoiceFor(choices, props.point, props.key)) }
  })
  const outcome = () => resolved()?.outcome
  // `stack` is the owner's default PLUS everyone who matched; `replace` is one contributor instead of
  // it (docs/plugins.md § Arbitration). The difference is only visible here, which is why it lives
  // here and not in the arbitration rule: `resolveSlot` answers who draws, not what else is on screen.
  const drawDefault = () => resolved()?.mode !== 'replace' || !outcome()?.occupants.length

  return (
    <>
      <Show when={drawDefault()}>{props.children}</Show>
      <Show when={outcome()?.occupants.length}>
        <For each={outcome()!.occupants}>
          {(contribution) => (
            <Show
              when={contribution.carrier === 'component' && contribution.component}
              fallback={
                <RemoteTree
                  contribution={{
                    id: contribution.id,
                    pluginId: contribution.pluginId,
                    hash: contribution.hash ?? '',
                    entry: contribution.entry ?? '',
                  }}
                  props={props.props ?? (() => ({}))}
                />
              }
            >
              {/* Spread rather than one `props` object, so the contributor writes an ordinary component
                  with the owner's own prop names. Solid keeps a dynamic spread reactive. */}
              {(component) => <Dynamic component={component()} {...(props.props?.() as Record<string, unknown>)} />}
            </Show>
          )}
        </For>
        {/* The disclosure past `max`. A count and no names: the owner set the ceiling because it is the
            owner's screen, and listing who was left out would be inviting a person to fix somebody
            else's arithmetic. */}
        <Show when={outcome()!.why === 'match' ? outcome()!.overflow : 0}>
          {(overflow) => <span class="muted">{overflow()} more from other plugins</span>}
        </Show>
      </Show>
    </>
  )
}
