/** @jsxImportSource @acorn/tui/jsx */
import { createSignal, ErrorBoundary, Show } from 'solid-js'
import { Dynamic } from '../tree/renderer'
import { createQuery } from '@tanstack/solid-query'
import type { CoreExclusiveSlot } from '@acorn/protocol/extensionPoints.ts'
import { PrefKeys } from '@acorn/client-core/infra/persistence'
import { prefsOptions } from '@acorn/client-core/infra/queries.ts'
import {
  CORE_SLOT_PROVIDER, exclusiveSlotChoices, noteExclusiveSlotFailure, resolveExclusiveSlot,
} from '@acorn/client-core/host/registries/extensionPoints'

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
export function ExclusiveSlot(props: { slot: CoreExclusiveSlot; value?: unknown }) {
  const prefs = createQuery(() => prefsOptions(true))
  const [threw, setThrew] = createSignal(false)
  const core = () => resolveExclusiveSlot(props.slot, CORE_SLOT_PROVIDER)
  const provider = () => {
    if (threw()) return core()
    return resolveExclusiveSlot(props.slot, exclusiveSlotChoices(prefs.data?.[PrefKeys.exclusiveSlots])[props.slot])
  }

  return (
    <Show when={provider()}>
      {(chosen) => (
        <ErrorBoundary
          fallback={() => {
            // Out of band, because a render must not write a signal it is being rendered from.
            queueMicrotask(() => {
              noteExclusiveSlotFailure(props.slot, chosen().pluginId)
              setThrew(true)
            })
            return <Dynamic component={core().component} value={props.value} />
          }}
        >
          <Dynamic component={chosen().component} value={props.value} />
        </ErrorBoundary>
      )}
    </Show>
  )
}
