import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { markAllRead, markRead, noticesForActiveNode, openNoticeTarget, openTarget, unreadCount } from './notifications'
import { createAttentionInbox } from './attentionInbox'
import { activeNodeId, setActiveNode } from '../node/activeNode'
import { nodes } from '../node/fleet'
import { noticeKindContribution } from '../registries/notices'
import Icon from '../ui/Icon'
import './notifications.css'
import { openRepoConfigTrust } from '../configTrust/configTrust'

const relTime = (at: number): string => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

// The top-bar bell (docs/terminal-and-agents.md): unread pill + popover, now holding TWO sections.
//
// "Needs you" is the attention inbox (docs/ui-design.md § Prompts and notifications), fleet-wide and fetched from every
// node. It shares the popover with notices rather than getting its own surface because the two answer
// adjacent questions — "what needs me" and "what happened" — and the popover already has the row chrome,
// the target-handler table and the task navigation both need. A separate rail source would have duplicated
// all three and split the unread pill's meaning.
//
// The sections differ in kind and the copy says so: an attention item is a STATE on the node and cannot be
// dismissed from here (dismiss it and the next fetch brings it back, correctly); a notice is an event that
// already happened and is client-local.
export default function NotificationBell(props: { onSelectTask: (taskId: string) => void }) {
  const [open, setOpen] = createSignal(false)
  const inbox = createAttentionInbox()
  const multiNode = () => nodes().length > 1
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
        {/* One pill for both sections. An attention item always counts — it is unresolved by definition —
            so it is added rather than max()'d with the unread notices. */}
        <Show when={unreadCount() + inbox().rows.length}>
          {(count) => <span class="notify-count">{count()}</span>}
        </Show>
      </button>
      <Show when={open()}>
        <div class="notify-popover">
          <Show when={inbox().rows.length || inbox().unavailable.length}>
            <div class="notify-head">
              <span>Needs you</span>
            </div>
            {/* Partial results are a banner, never a failed list (docs/architecture-overview.md § Fleet). */}
            <Show when={inbox().unavailable.length}>
              <div class="notify-banner" role="status">
                <For each={inbox().unavailable}>{(entry) => <span>{entry.label} unavailable</span>}</For>
              </div>
            </Show>
            <ul class="notify-list">
              <For each={inbox().rows}>
                {(row) => (
                  <li>
                    <button
                      type="button"
                      class="notify-row unread"
                      onClick={() => {
                        setOpen(false)
                        // The node FIRST, then the task: navigation resolves against the active node, so
                        // selecting a task on another node before switching would look up an id that is
                        // not there (and might collide with a local one).
                        if (row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
                        if (row.item.taskId) props.onSelectTask(row.item.taskId)
                        if (row.item.target && row.item.taskId) openTarget(row.item.taskId, row.item.target)
                      }}
                    >
                      <span class="notify-glyph" classList={{ 'notify-warn': row.item.severity !== 'info' }}>
                        <Icon name={row.item.severity === 'info' ? 'info' : 'alert-triangle'} />
                      </span>
                      <span class="notify-title">{row.item.title}</span>
                      <Show when={row.item.detail}><span class="notify-detail muted">{row.item.detail}</span></Show>
                      {/* The node badge only when there is more than one node — otherwise it is noise
                          naming the only machine there is (docs/ui-design.md: first-run never mentions nodes). */}
                      <Show when={multiNode()}><span class="notify-node muted">{row.node.label}</span></Show>
                      <span class="notify-time muted">{relTime(row.item.at)}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <div class="notify-head">
            <span>Notifications</span>
            <button type="button" class="notify-mark-all" onClick={markAllRead}>Mark all read</button>
          </div>
          <ul class="notify-list">
            <For each={noticesForActiveNode()} fallback={<li class="notify-empty muted">No notifications.</li>}>
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
                      if (n.action === 'review-config') openRepoConfigTrust(n.taskId)
                      openNoticeTarget(n)
                    }}
                  >
                    <span class="notify-glyph" classList={{ 'notify-warn': noticeKindContribution(n.kind)?.severity !== 'info' }}>
                      <Icon name={noticeKindContribution(n.kind)?.glyph ?? 'circle'} />
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
