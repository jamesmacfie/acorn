import { createEffect, on, type Accessor } from 'solid-js'
import type { NavigateOptions } from '@solidjs/router'
import { paneContribution } from '../../host/registries/panes/panes'
import { openPane } from '../../host/registries/commands/clientEvents'
import { taskPath } from '../../host/registries/commands/corePaths'

// Deep-linking into a task's panes.
//
// A task's URL stays `/t/:taskId`. The panes are a row with focus and maximise state persisted per
// task (`taskLayouts`), and a URL that owned that would be enormous or wrong the moment the owner
// moved a pane. What is worth an address is what `PaneIntent` already models: open this pane,
// select this item.
//
// A pane, an optional selected item, and an optional place in that item ride as query params,
// `/t/:taskId?pane=agents&item=<session>&at=42`, and are consumed once, then stripped. Left in, the URL would keep asserting a pane the owner has
// navigated away from.
//
// This gives `openPluginContentTarget` an address. Every pane plugin gets it without contributing a
// route.

const TASK_PANE_PARAM = 'pane'
const TASK_ITEM_PARAM = 'item'
const TASK_AT_PARAM = 'at'

export type TaskDeepLink = { pane: string; item?: string; at?: string }

// Pure, so the parsing rules are testable without a router. An unknown pane id is rejected here rather
// than dispatched: `openPane` would otherwise push a pane nothing can render into the persisted layout.
export function parseTaskDeepLink(search: Record<string, string | string[] | undefined>): TaskDeepLink | null {
  const first = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
  const pane = first(search[TASK_PANE_PARAM])
  const item = first(search[TASK_ITEM_PARAM])
  const at = first(search[TASK_AT_PARAM])
  if (!pane || !paneContribution(pane)) return null
  return { pane, ...(item ? { item, ...(at ? { at } : {}) } : {}) }
}

export type TaskDeepLinkOptions = {
  taskId: Accessor<string | null>
  search: Accessor<Record<string, string | string[] | undefined>>
  navigate: (to: string, options?: Partial<NavigateOptions>) => void
}

export function createTaskDeepLink(options: TaskDeepLinkOptions): void {
  createEffect(
    on(
      () => {
        const taskId = options.taskId()
        // Gated on the task being active rather than merely named in the URL, because the intent
        // opens a pane in the task view and the shell activates the routed task through its own
        // restore. The params are still there when it lands.
        return taskId ? { taskId, link: parseTaskDeepLink(options.search()) } : null
      },
      (current) => {
        if (!current?.link) return
        const { pane, item, at } = current.link
        openPane(current.taskId, pane, item ? { kind: 'plugin:select', item, ...(at ? { at } : {}) } : undefined)
        options.navigate(taskPath(current.taskId), { replace: true })
      },
    ),
  )
}
