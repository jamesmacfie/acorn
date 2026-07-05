import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { markAllRead, markRead, notices, unreadCount, type Notice } from './notifications'
import './notifications.css'

const KIND_GLYPH: Record<Notice['kind'], string> = {
  finished: '●',
  'needs-input': '‼',
  exited: '○',
  error: '✕',
  gate: '⛔',
  'run-done': '▸',
}

const relTime = (at: number): string => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

// The top-bar bell (docs/terminal-and-agents.md): unread pill + popover inbox. Clicking a row selects its task.
export default function NotificationBell(props: { onSelectTask: (taskId: string) => void }) {
  const [open, setOpen] = createSignal(false)
  let rootRef: HTMLDivElement | undefined

  const onDocPointer = (e: PointerEvent) => {
    if (open() && !rootRef?.contains(e.target as Node)) setOpen(false)
  }
  onMount(() => document.addEventListener('pointerdown', onDocPointer))
  onCleanup(() => document.removeEventListener('pointerdown', onDocPointer))

  return (
    <div class="notify-bell" ref={rootRef}>
      <button type="button" class="theme-toggle" title="Notifications" aria-expanded={open()} onClick={() => setOpen(!open())}>
        ◔
        <Show when={unreadCount()}>
          <span class="notify-count">{unreadCount()}</span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="notify-popover">
          <div class="notify-head">
            <span>Notifications</span>
            <button type="button" class="notify-mark-all" onClick={markAllRead}>Mark all read</button>
          </div>
          <ul class="notify-list">
            <For each={notices()} fallback={<li class="notify-empty muted">No notifications.</li>}>
              {(n) => (
                <li>
                  <button
                    type="button"
                    class="notify-row"
                    classList={{ unread: !n.read }}
                    onClick={() => {
                      markRead(n.id)
                      setOpen(false)
                      props.onSelectTask(n.taskId)
                    }}
                  >
                    <span class="notify-glyph" classList={{ 'notify-warn': n.kind === 'needs-input' || n.kind === 'error' || n.kind === 'gate' }}>
                      {KIND_GLYPH[n.kind]}
                    </span>
                    <span class="notify-title">{n.title}</span>
                    <Show when={n.detail}><span class="notify-detail muted">{n.detail}</span></Show>
                    <span class="notify-time muted">{relTime(n.at)}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>
    </div>
  )
}
