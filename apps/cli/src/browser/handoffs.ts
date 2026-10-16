import type {
  BridgeHandoff,
  BridgeHandoffItem,
  BridgePageTask,
  BridgeTaskPage,
} from '@acorn/protocol/extensionBridge.ts'
import type { BrowserHandoff, BrowserHandoffItem, TaskAddressList } from '@acorn/protocol/plugin/handoffs.ts'
import type { Project, Task } from '@acorn/protocol/api.ts'
import { parseSiteAddress } from '@acorn/protocol/siteAssociations.ts'

// Browser handoffs on the host side (docs/browser-extension/handoffs.md): what discovery shows the
// browser, which tasks already hold a resolved item, and the page addresses each task is known by
// (docs/browser-extension/task-pages.md). All are plain functions over the Node's own answers;
// `createBridge` makes the calls.

// Discovery without the route. The browser never names a route; the host looks it up again for each
// call, so a stale or forged list can't send a request anywhere the Node didn't declare.
export const bridgeHandoff = ({ resolve: _resolve, ...handoff }: BrowserHandoff): BridgeHandoff => handoff

// The Node validated a declared route when the plugin loaded. Checked again here because it decides
// where the host sends a request, a handoff's with the page address in it.
export const ownsRoute = (pluginId: string, route: string): boolean => {
  try {
    const url = new URL(route, 'https://acorn.invalid')
    return url.origin === 'https://acorn.invalid' && url.pathname.startsWith(`/v1/p/${pluginId}/`)
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

// What one plugin's task address route answered, parsed.
export type PublishedAddresses = { pluginId: string; addresses: TaskAddressList['addresses'] }

const TONES = { info: 'ok', warn: 'warn', danger: 'bad' } as const

// Every active task, with the addresses it is known by, so Home can list them all. Most come from the
// Node's task list alone, so finding a page's task costs no provider call: a task's links carry their
// item's address when the provider stamped one, and core records a pull request as the project's GitHub
// repository and the task's pull number rather than as a link, so its address is built here, as the
// GitHub plugin builds it. The rest are exact origins plugins published for their tasks, such as a
// running local stack's app. An address a code host knows matches in any case, as GitHub, GitLab, and
// Bitbucket read their paths.
export function taskPages(
  tasks: readonly Task[],
  published: readonly PublishedAddresses[] = [],
  codeHosts: readonly string[] = [],
): BridgePageTask[] {
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
      if (!parsed?.ok) return []
      return [{ ...parsed.site, source, ...(codeHosts.includes(source) ? { caseInsensitive: true } : {}) }]
    })
    for (const { pluginId, addresses: answered } of published)
      for (const address of answered)
        if (address.taskId === task.id)
          pages.push({
            origin: address.origin,
            pathPrefix: '/',
            source: pluginId,
            status: { label: address.label, state: address.state, tone: TONES[address.severity] },
          })
    return [{ id: task.id, title: task.title, branch: task.branch, projectId: task.projectId, pages }]
  })
}
