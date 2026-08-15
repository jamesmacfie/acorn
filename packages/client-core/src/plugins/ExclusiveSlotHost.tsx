import { createSignal, ErrorBoundary, Show, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import type { CoreExclusiveSlot } from '@acorn/protocol/extensionPoints.ts'
import { PrefKeys } from '../persistence/prefKeys'
import { prefsOptions } from '../queries'
import {
  exclusiveSlotChoices,
  noteExclusiveSlotFailure,
  resolveExclusiveSlot,
} from '../registries/exclusiveSlots'

// The one site where a plugin draws in place of a core surface — and the one site that guarantees core
// gets it back (registries/exclusiveSlots.ts holds the arbitration rule and its test).
//
// `core` is a FUNCTION, not a JSX prop, and that is deliberate rather than stylistic: core's own
// implementation of a replaced surface is a real subtree with real queries in it, and evaluating it on
// every render of a pane the user replaced would mean paying for both. A getter means the replaced
// implementation costs nothing while it is replaced.
//
// THREE WAYS BACK TO CORE, and the caller sees none of them:
//
//   nobody chosen / plugin gone   `resolveExclusiveSlot` answers null, the `Show` renders `core`.
//   the surface threw             the boundary records it and flips this instance out of the provider
//                                 branch, so the next render is core's. Recorded in the registry as well
//                                 as locally, because Settings has to be able to show that the choice is
//                                 not currently in effect.
//   the user changed their mind   the preference is the source of truth and this reads it live.
export default function ExclusiveSlotHost(props: { slot: CoreExclusiveSlot; core: () => JSX.Element }) {
  const prefs = createQuery(() => prefsOptions(true))
  const [threw, setThrew] = createSignal(false)
  const provider = () => {
    if (threw()) return null
    const choice = exclusiveSlotChoices(prefs.data?.[PrefKeys.exclusiveSlots])[props.slot]
    return resolveExclusiveSlot(props.slot, choice)
  }

  return (
    <Show when={provider()} fallback={props.core()}>
      {(chosen) => (
        <ErrorBoundary
          fallback={() => {
            // Out of band, because a render must not write a signal it is being rendered from. The
            // microtask flips `provider()` to null and the `Show` above draws core's implementation on
            // the next tick; one frame of nothing is the whole cost of a plugin that crashed.
            queueMicrotask(() => {
              noteExclusiveSlotFailure(props.slot, chosen().pluginId)
              setThrew(true)
            })
            return null
          }}
        >
          <Dynamic component={chosen().component} />
        </ErrorBoundary>
      )}
    </Show>
  )
}
