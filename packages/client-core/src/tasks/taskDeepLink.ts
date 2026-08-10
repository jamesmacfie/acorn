import { createEffect, on, type Accessor } from 'solid-js'
import type { NavigateOptions } from '@solidjs/router'
import { paneContribution } from '../registries/panes'
import { openPane } from '../registries/clientEvents'
import { taskPath } from '../registries/corePaths'

// Deep-linking into a task's panes.
//
// A task's URL is `/t/:taskId` and stays that way. The panes are a left→right ROW with focus and maximise
// state, persisted per task (tasks/tasks.ts) — a URL that tried to own that would either be enormous or
// wrong the moment the owner moved a pane. What is worth an address is the thing `PaneIntent` already
// models: open this pane, select this item.
//
// So the intent rides as query params — `/t/:taskId?pane=linear&item=ENG-404` — and is consumed ONCE, then
// stripped. Stripping is deliberate: leaving them in the URL would leave it asserting a pane the owner has
// since navigated away from, and the layout restores itself from its own persisted state anyway.
//
// This is what turns `openPluginContentTarget` (registries/contentLinks.ts) from a fire-and-forget event
// into something with an address. Every pane plugin gets it without contributing a route.

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
      // Gated on the task being ACTIVE, not merely named in the URL: the intent opens a pane in the task
      // view, and the shell activates the routed task through its own restore. Waiting costs nothing —
      // the params are still there when it lands.
      return taskId ? ({ taskId, link: parseTaskDeepLink(options.search()) }) : null
    },
    (current) => {
      if (!current?.link) return
      openPane(current.taskId, current.link.pane, { kind: 'plugin:select', item: current.link.item })
      options.navigate(taskPath(current.taskId), { replace: true })
    },
  ))
}
