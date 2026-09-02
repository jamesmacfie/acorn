import { For, onCleanup, onMount, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { markAllRead, markRead, noticesForActiveNode, openNoticeTarget, openTarget, unreadCount, type Notice } from './notifications'
import { createAttentionInbox, markAttentionSeen } from './attentionInbox'
import { parseNotificationSettings } from './settings'
import { onNoticeActivated } from '../../infra/platform'
import { trackBadge } from './badge'
import { prefsOptions } from '../../infra/queries'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { activeNodeId, setActiveNode } from '../../infra/node/activeNode'
import { nodes } from '../../infra/node/fleet'
import { noticeKindContribution } from '../../host/registries/rail/notices'
import Icon from '../../kit/components/content/Icon'
import { Alert, Button } from '../../kit/components/primitives'
import Popover from '../../kit/components/overlays/Popover'
import './notifications.css'
import { openRepoConfigTrust } from '../settings/trust/configTrust'
import { openPluginApproval } from '../../host/trust/approval'

const relTime = (at: number): string => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

// The top-bar bell: unread pill plus popover, holding two sections.
//
// "Needs you" is the attention inbox, fleet-wide and fetched from every node. It shares the
// popover with notices rather than getting its own surface because the two answer adjacent
// questions, "what needs me" and "what happened", and the popover already has the row chrome, the
// target-handler table and the task navigation both need. A separate rail source would have
// duplicated all three and split the unread pill's meaning.
//
// The sections differ in kind and the copy says so: an attention item is a state on the node and
// cannot be dismissed from here (dismiss it and the next fetch brings it back, correctly); a
// notice is an event that already happened and is client-local.
export default function NotificationBell(props: { onSelectTask: (taskId: string) => void }) {
  const inbox = createAttentionInbox()
  const multiNode = () => nodes().length > 1
  // One pill for both sections. An attention item always counts — it is unresolved by definition — so
  // it is added rather than max()'d with the unread notices.
  const pill = () => unreadCount() + inbox().rows.length

  // "Mark all read" means the number the bell shows, and the bell shows both sections. Notices go
  // read; an attention row retires only if it is a nudge, which is the rule `attentionIsAcknowledged`
  // keeps — a block is still a block after you have read about it.
  const clearAll = () => {
    markAllRead()
    for (const row of inbox().rows) markAttentionSeen(row.nodeId, row.item.id, row.item.at)
  }

  // Opening a notice, from the row below and from a click on the system banner it raised. One
  // function because the two are the same act: the banner is the row, drawn by the OS.
  const openNotice = (notice: Notice) => {
    markRead(notice.id)
    props.onSelectTask(notice.taskId)
    if (notice.action === 'review-config') openRepoConfigTrust(notice.taskId)
    if (notice.action === 'review-plugin-request') openPluginApproval(notice.taskId)
    openNoticeTarget(notice)
  }

  // The banner carries the notice id as its tag, so an activation finds the notice it came from. The
  // active node's, matching what this popover shows: a notice raised before a node switch names a task
  // this client can no longer resolve.
  onMount(() => onCleanup(onNoticeActivated((tag) => {
    const notice = noticesForActiveNode().find((n) => n.id === tag)
    if (notice) openNotice(notice)
  })))

  // The app icon carries the pill's number (badge.ts). The switch is read through the prefs query
  // rather than the device store, because turning the badge off has to clear it now rather than at
  // the next unread.
  const prefs = createQuery(() => prefsOptions(true))
  trackBadge(pill, () => parseNotificationSettings(prefs.data?.[PrefKeys.notifications]).badge)

  // Popover for the chrome only: the portal, the anchoring, outside-click and the Escape this
  // never had. The content stays as it is: an inbox with two sections and dismissable rows is not
  // a list of menu items, so it is not a Menu.
  return (
    <Popover
      role="dialog"
      ariaLabel="Notifications"
      placement="bottom-end"
      trigger={({ open, toggle }) => (
        <Button variant="bare" title="Notifications" label="Notifications" expanded={open()} onPress={toggle}>
          <Icon name="bell" />
          <Show when={pill()}>
            {(count) => <span class="notify-count">{count()}</span>}
          </Show>
        </Button>
      )}
    >
      {({ close }) => (
        <div class="notify-inbox">
          <Show when={inbox().rows.length || inbox().unavailable.length}>
            <div class="notify-head">
              <span>Needs you</span>
            </div>
            {/* Partial results are a banner, never a failed list (docs/architecture-overview.md § Fleet). */}
            <Show when={inbox().unavailable.length}>
              <For each={inbox().unavailable}>
                {(entry) => <Alert tone="warn" variant="banner">{entry.label} unavailable</Alert>}
              </For>
            </Show>
            <ul class="notify-list">
              <For each={inbox().rows}>
                {(row) => (
                  <li>
                    <button
                      type="button"
                      class="notify-row unread"
                      onClick={() => {
                        close()
                        // The node first, then the task: navigation resolves against the active
                        // node, so selecting a task on another node before switching would look up
                        // an id that is not there (and might collide with a local one).
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
            <Button variant="bare" onPress={clearAll}>Mark all read</Button>
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
                      close()
                      openNotice(n)
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
      )}
    </Popover>
  )
}
