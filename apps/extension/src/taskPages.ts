import type { BridgePageTask, BridgeTaskPage } from '@acorn/protocol/extensionBridge.ts'
import { siteMatches } from '@acorn/protocol/siteAssociations.ts'

// Which tasks a page belongs to (docs/browser-extension/task-pages.md). The background keeps the selected
// Node's list from `tasks.pages`, and the sidebar and the task chip both match the page against it
// here, in the browser, as project sites are, so no page address goes to the Node for it.

// A task the page belongs to, and the address of the task's that it matched.
export type PageTask = { task: BridgePageTask; page: BridgeTaskPage }

// GitHub reads owner and repository names in any case, so `/Acme/Runn/pull/482` is the same pull
// request as `/acme/runn/pull/482`. Other sites' paths are matched as they are.
export const pageMatches = (page: BridgeTaskPage, url: string): boolean =>
  page.source === 'github'
    ? siteMatches({ origin: page.origin, pathPrefix: page.pathPrefix.toLowerCase() }, url.toLowerCase())
    : siteMatches(page, url)

// In the Node's order. The origin must match exactly and the path by whole segments, so a pull
// request's address covers its tabs, a trailing slash, a query, and a fragment.
export const pageTasks = (tasks: readonly BridgePageTask[], url: string | undefined): PageTask[] =>
  url
    ? tasks.flatMap((task) => {
        const page = task.pages.find((candidate) => pageMatches(candidate, url))
        return page ? [{ task, page }] : []
      })
    : []

// The task whose app a plugin published at this page's origin, such as a running local stack, which
// the branch marker shows.
export const appTask = (tasks: readonly BridgePageTask[], url: string | undefined): PageTask | null =>
  pageTasks(tasks, url).find(({ page }) => page.status) ?? null
