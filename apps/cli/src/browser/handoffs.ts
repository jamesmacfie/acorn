import type {
  BridgeHandoff,
  BridgeHandoffItem,
  BridgePageTask,
  BridgeTaskPage,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserHandoff, BrowserHandoffItem } from '@acorn/protocol/plugin/handoffs.ts'
import type { Project, Task } from '@acorn/protocol/api.ts'
import { parseSiteAddress } from '@acorn/protocol/siteAssociations.ts'

// Browser handoffs on the host side (docs/browser-extension/handoffs.md): what discovery shows the
// browser, which tasks already hold a resolved item, and the page addresses each task is known by
// (docs/browser-extension/task-pages.md). All are plain functions over the Node's own answers;
// `createBridge` makes the calls.

// Discovery without the route. The browser never names a route; the host looks it up again for each
// call, so a stale or forged list can't send a request anywhere the Node didn't declare.
export const bridgeHandoff = ({ resolve: _resolve, ...handoff }: BrowserHandoff): BridgeHandoff => handoff

// The Node validated this when the plugin loaded. Checked again here because it is the one value that
// decides where the host sends the page address.
export const ownsRoute = (handoff: BrowserHandoff): boolean => {
  try {
    const url = new URL(handoff.resolve, 'https://acorn.invalid')
    return url.origin === 'https://acorn.invalid' && url.pathname.startsWith(`/v1/p/${handoff.pluginId}/`)
  } catch {
    return false
  }
}

// Active tasks that already hold this item. A connection-stamped link names the item anywhere. A pull
// number names it only inside a project the provider tied the item to, because `#12` means another pull
// request in any other repository.
export function linkedTasks(item: BrowserHandoffItem, tasks: readonly Task[]): Task[] {
  const links = item.seed.links ?? []
  const pullNumber = item.seed.pullNumber
  return tasks.filter(
    (task) =>
      task.status === 'active' &&
      (task.links.some((link) =>
        links.some((wanted) => wanted.connectionId === link.connectionId && wanted.identifier === link.identifier),
      ) ||
        (pullNumber !== undefined && task.pullNumber === pullNumber && item.projects.includes(task.projectId))),
  )
}

// The projects a linked task may be created in: the ones the provider tied the item to, then any whose
// site associations cover the page. A pull number names a pull request only in its own repository, so
// an item carrying one stays with the provider's projects.
export const creatableProjects = (item: BrowserHandoffItem, siteProjects: readonly string[]): string[] =>
  item.seed.pullNumber === undefined ? [...new Set([...item.projects, ...siteProjects])] : item.projects

export function bridgeHandoffItem(
  item: BrowserHandoffItem,
  projects: readonly Project[],
  tasks: readonly Task[],
  siteProjects: readonly string[],
): BridgeHandoffItem {
  const names = new Map(projects.map((project) => [project.id, project.name]))
  return {
    identifier: item.identifier,
    url: item.url,
    title: item.title,
    connection: item.connection,
    // A project the Node no longer has drops out, rather than offering a create that would fail.
    projects: creatableProjects(item, siteProjects).flatMap((id) =>
      names.has(id) ? [{ id, name: names.get(id)! }] : [],
    ),
    linkedTasks: linkedTasks(item, tasks).map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
    })),
    context: item.context ?? null,
  }
}

// The addresses each active task already records, from the Node's task list alone, so finding a
// page's task costs no provider call. A task's links carry their item's address when the provider
// stamped one. Core records a pull request as the project's GitHub repository and the task's pull
// number rather than as a link, so its address is built here, as the GitHub plugin builds it.
export function taskPages(tasks: readonly Task[]): BridgePageTask[] {
  return tasks.flatMap((task) => {
    if (task.status !== 'active') return []
    const addresses: { url: string | undefined; source: string }[] = [
      ...(task.github && task.pullNumber
        ? [
            {
              url: `https://github.com/${task.github.owner}/${task.github.name}/pull/${task.pullNumber}`,
              source: 'github',
            },
          ]
        : []),
      ...task.links.map((link) => ({ url: link.ref?.url, source: link.providerId })),
    ]
    const pages = addresses.flatMap(({ url, source }): BridgeTaskPage[] => {
      const parsed = url ? parseSiteAddress(url) : null
      return parsed?.ok ? [{ ...parsed.site, source }] : []
    })
    return pages.length
      ? [{ id: task.id, title: task.title, branch: task.branch, projectId: task.projectId, pages }]
      : []
  })
}
