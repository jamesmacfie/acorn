import type { PaneSwitcherData, PaneSwitcherProps } from '@acorn/protocol/paneSwitcher.ts'
import type { OwnerActions } from '../tree/hostRequests'

// The worker receives plain data and a closed set of host action names. Never clone the compiled
// props: those contain functions, and structured clone would reject them before a tree can mount.
export const PANE_SWITCHER_ACTIONS = ['show', 'add', 'close', 'pin', 'toggleMaximize', 'equalize'] as const

export function paneSwitcherRemote(value: PaneSwitcherProps): { data: PaneSwitcherData; actions: OwnerActions } {
  const data: PaneSwitcherData = {
    panes: value.panes,
    task: value.task,
    maximized: value.maximized,
  }
  const paneAction = (run: (id: string) => void) => (payload: unknown) => {
    if (typeof payload !== 'string' || !value.panes.some((pane) => pane.id === payload)) {
      throw new Error('That pane is not available in this switcher')
    }
    run(payload)
  }
  return {
    data,
    actions: {
      show: paneAction(value.show),
      add: paneAction(value.add),
      close: paneAction(value.close),
      pin: paneAction(value.pin),
      toggleMaximize: paneAction(value.toggleMaximize),
      equalize: () => value.equalize(),
    },
  }
}
