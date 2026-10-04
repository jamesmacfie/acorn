import { createSignal, onCleanup } from 'solid-js'

// Whether a panel studio is on screen. The studio covers the task like Settings does, so the shell
// stands the task's keybindings down while it is open (apps/desktop/src/client/App.tsx).

const [open, setOpen] = createSignal(0)

export const isPanelStudioOpen = (): boolean => open() > 0

/** Called from the studio's setup: counts it open until its scope is disposed. */
export function markPanelStudioOpen(): void {
  setOpen(count => count + 1)
  onCleanup(() => setOpen(count => count - 1))
}
