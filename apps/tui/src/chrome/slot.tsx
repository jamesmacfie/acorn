/** @jsxImportSource @opentui/solid */
import { createSignal, ErrorBoundary, Show, type JSX } from 'solid-js'
import { Dynamic } from '@opentui/solid'
import { createQuery } from '@tanstack/solid-query'
import type { CoreExclusiveSlot } from '@acorn/protocol/extensionPoints.ts'
import { PrefKeys } from '@acorn/client-core/infra/persistence/prefKeys.ts'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import {
  exclusiveSlotChoices, noteExclusiveSlotFailure, resolveExclusiveSlot,
} from '@acorn/client-core/host/registries/extensionPoints/exclusiveSlots.ts'

// The terminal host's `ExclusiveSlotHost`: where a plugin draws in place of one of core's own
// surfaces, and where core gets it back.
//
// The same split as `KIT_COMPONENTS` and the layout table. The arbitration rule — who draws, which
// preference decides, what a failure does — is client-core's `exclusiveSlots.ts` and is shared
// unchanged; only the drawing is the host's. The DOM host's file cannot be reused for one import:
// `Dynamic` there comes from `solid-js/web`, which is the DOM renderer, and pulling it into this
// process would put a second Solid renderer in the graph for a component that renders one child.
//
// Every one of the three ways back to core is the DOM host's, line for line: nobody chose, the
// surface threw, or the reader changed their mind.
export function ExclusiveSlot(props: { slot: CoreExclusiveSlot; core: () => JSX.Element }) {
  const prefs = createQuery(() => prefsOptions(true))
  const [threw, setThrew] = createSignal(false)
  const provider = () => {
    if (threw()) return null
    return resolveExclusiveSlot(props.slot, exclusiveSlotChoices(prefs.data?.[PrefKeys.exclusiveSlots])[props.slot])
  }

  return (
    <Show when={provider()} fallback={props.core()}>
      {(chosen) => (
        <ErrorBoundary
          fallback={() => {
            // Out of band, because a render must not write a signal it is being rendered from.
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
