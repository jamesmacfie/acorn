import { createEffect, createSignal, onCleanup, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { isTerminalMax, PrefKeys, prefsOptions, savePref, type Task } from '@acorn/plugin-api/client'
import { createSplitDrag, SplitHandle } from '@acorn/plugin-api/ui'
import { Drawer } from '@acorn/plugin-api/ui/host'
import TerminalSessions from './TerminalSessions'

// The desktop's bottom drawer of the task's terminal sessions. It owns the box: its height, the grip
// that drags it and the maximized state. What is inside is ./TerminalSessions.tsx.
export default function TerminalPanel(props: { onClose: () => void; task: Task | null }) {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  let drawerRef: HTMLElement | undefined
  // Snapshotted at pointer-down. Null between drags, so a keyboard nudge measures from the current
  // height instead of the last drag's starting point.
  let dragStartHeight: number | null = null

  // Maximized (⌘⇧⏎) fills the pane region via CSS (top: --topbar-h); the partial drag-height is ignored.
  const maximized = () => isTerminalMax(props.task?.id)

  // Drawer height, seeded once from the `term_height` pref, then dragged and persisted. It never
  // grows past 85% of the window, so its drag handle stays on screen. A height saved on a taller
  // screen, or kept through a window shrink, is pulled back to that limit.
  const maxHeight = () => window.innerHeight * 0.85
  const [height, setHeight] = createSignal(360)
  let seeded = false
  createEffect(() => {
    const saved = Number(prefs.data?.[PrefKeys.terminalHeight])
    if (!seeded && Number.isFinite(saved) && saved > 0) {
      setHeight(Math.min(saved, maxHeight()))
      seeded = true
    }
  })
  const clampToWindow = () => setHeight((current) => Math.min(current, maxHeight()))
  window.addEventListener('resize', clampToWindow)
  onCleanup(() => window.removeEventListener('resize', clampToWindow))
  // Publish the live drawer height so the task view (`.workspace-wrap`) can reserve that much space
  // at the bottom. The panes shrink to sit above the drawer (keeping their scrollbars) instead of
  // being covered by this fixed overlay. Cleared when the drawer unmounts (terminal closed).
  createEffect(() => document.documentElement.style.setProperty('--term-drawer-h', `${height()}px`))
  onCleanup(() => document.documentElement.style.removeProperty('--term-drawer-h'))

  // The drawer grows upward, so a downward drag shrinks it: hence the inverted delta and `invert`
  // for the keyboard. Height and its pref stay here; the hook owns the drag and the keys this
  // handle never had.
  const drawerDrag = createSplitDrag({
    axis: 'y',
    label: 'Resize terminal drawer',
    invert: true,
    onStart: () => {
      dragStartHeight = height()
    },
    onDelta: (deltaPx) => setHeight(Math.min(Math.max((dragStartHeight ?? height()) - deltaPx, 160), maxHeight())),
    onCommit: () => {
      dragStartHeight = null
      void savePref(queryClient, PrefKeys.terminalHeight, String(Math.round(height())))
    },
  })

  return (
    <Drawer
      ref={(element) => {
        drawerRef = element
      }}
      ariaLabel="Terminal"
      height={height()}
      maximized={maximized()}
    >
      <Show when={!maximized()}>
        <SplitHandle axis="y" drag={drawerDrag} />
      </Show>
      <TerminalSessions task={props.task} onClose={props.onClose} root={() => drawerRef} />
    </Drawer>
  )
}
