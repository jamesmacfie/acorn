import { createSignal, ErrorBoundary, Show, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import { createQuery } from '@tanstack/solid-query'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { prefsOptions } from '../../infra/queries'
import {
  CORE_SLOT_PROVIDER,
  exclusiveSlotChoices,
  exclusiveSlotFailureEpoch,
  noteExclusiveSlotFailure,
  resolveExclusiveSlot,
} from '../registries/extensionPoints/exclusiveSlots'
import { pushNotice } from '../../features/notifications/notifications'
import { activeTaskId } from '../../features/tasks/tasks'
import { WithNestedChromeSlots } from './NestedChromeSlot'
import type { RailProps, SlotRef, TopbarProps } from '@acorn/protocol/chrome.ts'
import type { PaneSwitcherProps } from '@acorn/protocol/paneSwitcher.ts'
import { ExclusiveSlotFailureContext } from './ExclusiveSlotFailure'

// The one site where a plugin draws in place of a core surface, and the one site that guarantees core
// gets it back (registries/exclusiveSlots.ts holds the arbitration rule).
//
// Every path selects a registered provider. The fallback is the registered core component, so an
// absent, disabled, untrusted, or failed offer does not need a second rendering mechanism.
type NestedSlotMount = { ref: SlotRef; render: () => JSX.Element }
type ExclusiveSlotHostProps =
  | { slot: 'rail.taskList'; value?: never; nestedSlots?: never }
  | { slot: 'pane.switcher'; value: PaneSwitcherProps; nestedSlots?: never }
  | { slot: 'rail'; value: RailProps; nestedSlots: readonly NestedSlotMount[] }
  | { slot: 'topbar'; value: TopbarProps; nestedSlots: readonly NestedSlotMount[] }

export default function ExclusiveSlotHost(props: ExclusiveSlotHostProps) {
  const prefs = createQuery(() => prefsOptions(true))
  const [failedInstance, setFailedInstance] = createSignal<{ key: string; epoch: number } | null>(null)
  let reporting = false
  const core = () => resolveExclusiveSlot(props.slot, CORE_SLOT_PROVIDER)
  const provider = () => {
    const choice = exclusiveSlotChoices(prefs.data?.[PrefKeys.exclusiveSlots])[props.slot]
    const failed = failedInstance()
    if (choice && failed?.key === `${props.slot}:${choice}` && failed.epoch === exclusiveSlotFailureEpoch()) return core()
    return resolveExclusiveSlot(props.slot, choice)
  }
  const report = (pluginId: string) => {
    if (reporting) return
    reporting = true
    queueMicrotask(() => {
      reporting = false
      noteExclusiveSlotFailure(props.slot, pluginId)
      setFailedInstance({ key: `${props.slot}:${pluginId}`, epoch: exclusiveSlotFailureEpoch() })
      pushNotice({
        taskId: activeTaskId() ?? '', kind: 'plugin',
        title: `${pluginId} could not draw ${props.slot}; acorn restored its own surface`,
        at: Date.now(),
      })
    })
  }

  return (
    <WithNestedChromeSlots slots={props.nestedSlots ?? []}>
    <Show keyed when={provider()}>
      {(chosen) => (
        <ErrorBoundary
          fallback={() => {
            if (chosen.pluginId === CORE_SLOT_PROVIDER) return null
            // Draw core in this render, then publish the failure outside Solid's render pass.
            report(chosen.pluginId)
            return <Dynamic component={core().component} value={props.value} />
          }}
        >
          <ExclusiveSlotFailureContext.Provider value={chosen.pluginId === CORE_SLOT_PROVIDER ? undefined : () => report(chosen.pluginId)}>
            <Dynamic component={chosen.component} value={props.value} />
          </ExclusiveSlotFailureContext.Provider>
        </ErrorBoundary>
      )}
    </Show>
    </WithNestedChromeSlots>
  )
}
