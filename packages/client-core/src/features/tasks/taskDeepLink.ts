import { createEffect, on, type Accessor } from 'solid-js'
import type { NavigateOptions } from '@solidjs/router'
import { paneContribution } from '../../host/registries/panes/panes'
import { openPane } from '../../host/registries/commands/clientEvents'
import { taskPath } from '../../host/registries/commands/corePaths'

// Deep-linking into a task's panes.
//
// A task's URL stays `/t/:taskId`. The panes are a row with focus and maximise state persisted per
// task (tasks/tasks.ts), and a URL that owned that would be enormous or wrong the moment the owner
// moved a pane. What is worth an address is what `PaneIntent` already models: open this pane,
// select this item.
//
// So the intent rides as query params, `/t/:taskId?pane=linear&item=ENG-404`, is consumed once,
// then stripped. Left in, the URL would keep asserting a pane the owner has navigated away from.
//
// This gives `openPluginContentTarget` (registries/contentLinks.ts) an address. Every pane plugin
// gets it without contributing a route.

export const TASK_PANE_PARAM = 'pane'
export const TASK_ITEM_PARAM = 'item'

export type TaskDeepLink = { pane: string; item: string }

// Pure, so the parsing rules are testable without a router. An unknown pane id is rejected here rather
// than dispatched: `openPane` would otherwise push a pane nothing can render into the persisted layout.
export function parseTaskDeepLink(search: Record<string, string | string[] | undefined>): TaskDeepLink | null {
  const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? '' : value ?? '')
  const pane = first(search[TASK_PANE_PARAM])
  const item = first(search[TASK_ITEM_PARAM])
  if (!pane || !item || !paneContribution(pane)) return null
  return { pane, item }
}

export type TaskDeepLinkOptions = {
  taskId: Accessor<string | null>
  search: Accessor<Record<string, string | string[] | undefined>>
  navigate: (to: string, options?: Partial<NavigateOptions>) => void
}

export function createTaskDeepLink(options: TaskDeepLinkOptions): void {
  createEffect(on(
    () => {
      const taskId = options.taskId()
      // Gated on the task being active rather than merely named in the URL, because the intent
      // opens a pane in the task view and the shell activates the routed task through its own
      // restore. The params are still there when it lands.
      return taskId ? ({ taskId, link: parseTaskDeepLink(options.search()) }) : null
    },
    (current) => {
      if (!current?.link) return
      openPane(current.taskId, current.link.pane, { kind: 'plugin:select', item: current.link.item })
      options.navigate(taskPath(current.taskId), { replace: true })
    },
  ))
}
