import type { BridgeHandoff, BridgeHandoffItem } from '@acorn/protocol/extensionBridge.ts'
import type { BrowserHandoff, BrowserHandoffItem } from '@acorn/protocol/plugin/handoffs.ts'
import type { Project, Task } from '@acorn/protocol/api.ts'

// Browser handoffs on the host side (docs/browser-extension/handoffs.md): what discovery shows the
// browser, and which tasks already hold a resolved item. Both are plain functions over the Node's own
// answers; `createBridge` makes the calls.

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

export function bridgeHandoffItem(
  item: BrowserHandoffItem,
  projects: readonly Project[],
  tasks: readonly Task[],
): BridgeHandoffItem {
  const names = new Map(projects.map((project) => [project.id, project.name]))
  return {
    identifier: item.identifier,
    url: item.url,
    title: item.title,
    connection: item.connection,
    // A project the Node no longer has drops out, rather than offering a create that would fail.
    projects: item.projects.flatMap((id) => (names.has(id) ? [{ id, name: names.get(id)! }] : [])),
    linkedTasks: linkedTasks(item, tasks).map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
    })),
    context: item.context ?? null,
  }
}
