import type { BridgePageTask } from '@acorn/protocol/extensionBridge.ts'
import { siteMatches } from '@acorn/protocol/siteAssociations.ts'

// Which tasks a page belongs to (docs/browser-extension/task-pages.md). The background keeps the selected
// Node's list from `tasks.pages`, and the sidebar and the task chip both match the page against it
// here, in the browser, as project sites are, so no page address goes to the Node for it.

// A task the page belongs to, and the plugin or provider whose address it matched.
export type PageTask = { task: BridgePageTask; source: string }

// In the Node's order. The origin must match exactly and the path by whole segments, so a pull
// request's address covers its tabs, a trailing slash, a query, and a fragment.
export const pageTasks = (tasks: readonly BridgePageTask[], url: string | undefined): PageTask[] =>
  url
    ? tasks.flatMap((task) => {
        const page = task.pages.find((candidate) => siteMatches(candidate, url))
        return page ? [{ task, source: page.source }] : []
      })
    : []
