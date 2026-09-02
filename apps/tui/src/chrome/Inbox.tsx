/** @jsxImportSource @opentui/solid */
import { For, onCleanup, Show } from 'solid-js'
import type { BoxRenderable } from '@opentui/core'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { createAttentionInbox, type AttentionInbox } from '@acorn/client-core/features/notifications/attentionInbox.ts'
import { trackBadge } from '@acorn/client-core/features/notifications/badge.ts'
import {
  markRead, noticesForActiveNode, openNoticeTarget, openTarget, unreadCount,
} from '@acorn/client-core/features/notifications/notifications.ts'
import { activeNodeId, setActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { nodes } from '@acorn/client-core/infra/node/fleet.ts'
import { Line } from '../kit/cells'
import { Modal, ModalBody } from '../kit/grouping'
import { EmptyState, Row, Rows } from '../kit/showing'
import { takeFocus } from '../keys/regions'
import { closeOverlay } from './state'
import type { ShellModel } from './model'

// What is waiting, as the bell's two sections in a terminal
// (docs/tui.md § What is drawn bespoke).
//
// The desktop draws this in a popover under the topbar bell. There is no popover here and no bell to
// hang one under, so it is an overlay opened on `n` — and an overlay rather than a fourth panel
// because the column has three framed panels and twenty-two rows to spend at 80 by 24. An inbox that
// is open only when asked costs nothing when it is closed (docs/tui.md § The screen).
//
// The data is the bell's, not its component: `createAttentionInbox` is the same fleet-wide fan-out
// and `noticesForActiveNode` the same ring. What differs is the pixels, and one shape — the two
// sections are one collection here rather than two, because a modal swallows `nextRegion` and a
// second collection inside one would be a list nobody could reach (../keys/trap.ts).

// The inbox memo and the badge effect belong to the shell, which outlives every opening of this
// overlay: the number in the topbar has to be right while the overlay is shut. `initInbox` is what
// the shell calls, and this is where the accessor it built is read from — the same shape
// `setPaneCycler` and `setTopology` use for the other two things the chrome owns and the parts read.
let inbox: (() => AttentionInbox) | null = null

/** Own the inbox and keep the topbar's number in step with it. Called once, from the shell, inside
 *  its reactive root. */
export function initInbox(): void {
  const rows = createAttentionInbox()
  inbox = rows
  onCleanup(() => { inbox = null })
  // One pill for both sections, the same sum the desktop's bell shows: an attention item always
  // counts, because it is unresolved by definition. `setBadge` on this host writes the signal the
  // topbar draws (../kit/notify.ts).
  //
  // Always on, where the desktop reads the `badge` switch. There is no device preference store here,
  // and `ACORN_TUI_NOTIFY` is about the channels that interrupt you — a number in your own topbar is
  // not one of them.
  trackBadge(() => unreadCount() + rows().rows.length, () => true)
}

type InboxRow = {
  key: string
  section: 'Needs you' | 'Notifications'
  first: boolean
  title: string
  detail?: string
  unread: boolean
  open: () => void
}

export function Inbox(props: { model: ShellModel }) {
  const close = () => closeOverlay('notifications')

  const openTask = (taskId: string | undefined): void => {
    if (!taskId) return
    const task = props.model.allTasks().find((row) => row.id === taskId)
    if (task) activateTaskSignals(task)
  }

  const rows = (): InboxRow[] => {
    const attention = inbox?.().rows ?? []
    const notices = noticesForActiveNode()
    return [
      ...attention.map((row, at): InboxRow => ({
        key: `attention:${row.nodeId}:${row.item.id}`,
        section: 'Needs you',
        first: at === 0,
        title: row.item.title,
        ...(row.item.detail ? { detail: row.item.detail } : {}),
        unread: true,
        open: () => {
          // The node first, then the task: navigation resolves against the active node, so opening a
          // task on another node before switching would look up an id that is not there.
          if (row.nodeId !== activeNodeId()) setActiveNode(row.nodeId)
          openTask(row.item.taskId)
          if (row.item.target && row.item.taskId) openTarget(row.item.taskId, row.item.target)
        },
      })),
      ...notices.map((notice, at): InboxRow => ({
        key: `notice:${notice.id}`,
        section: 'Notifications',
        first: at === 0,
        title: notice.title,
        ...(notice.detail ? { detail: notice.detail } : {}),
        unread: !notice.read,
        open: () => {
          markRead(notice.id)
          openTask(notice.taskId)
          openNoticeTarget(notice)
        },
      })),
    ]
  }

  // Only worth naming the machine when there is more than one, which is the rule the bell keeps: a
  // node label beside the only node there is names the only machine there is.
  const multiNode = () => nodes().length > 1
  const nodeLabel = (key: string): string | undefined => {
    if (!multiNode() || !key.startsWith('attention:')) return undefined
    return inbox?.().rows.find((row) => `attention:${row.nodeId}:${row.item.id}` === key)?.node.label
  }

  return (
    <Modal onDismiss={close} title="Notifications" size="md">
      <ModalBody>
        <box flexDirection="column" ref={(element: BoxRenderable) => takeFocus(element)}>
          {/* Partial results are a banner, never a failed list (docs/architecture-overview.md § Fleet). */}
          <For each={inbox?.().unavailable ?? []}>
            {(entry) => <Line tone="warn">{`${entry.label} unavailable`}</Line>}
          </For>
          <Show
            when={rows().length}
            fallback={<EmptyState title="Nothing waiting">No notifications, and nothing needs you.</EmptyState>}
          >
            <Rows
              id="chrome.inbox"
              ariaLabel="Notifications"
              items={rows()}
              onActivate={(key) => {
                const row = rows().find((candidate) => candidate.key === key)
                close()
                row?.open()
              }}
            >
              {(row, item) => (
                // The section head rides above its first row rather than being a row of its own: one
                // collection means `j` and `k` walk the whole inbox, and a head that was an item
                // would be a stop that opens nothing.
                <box flexDirection="column" flexShrink={0}>
                  <Show when={row.first}><Line role="eyebrow">{row.section}</Line></Show>
                  <Row
                    item={item}
                    selected={row.unread}
                    meta={<Show when={nodeLabel(row.key)}>{(label) => <Line role="muted">{label()}</Line>}</Show>}
                  >
                    {row.detail ? `${row.title} — ${row.detail}` : row.title}
                  </Row>
                </box>
              )}
            </Rows>
          </Show>
        </box>
      </ModalBody>
    </Modal>
  )
}
