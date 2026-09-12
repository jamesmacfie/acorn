import type { AppDatabase } from '../db/index'
import { RUN_TARGETS, type RunBridge } from '../routes/plugins/harness'
import { routeTestCapabilityFor } from '../bridge'
import type { CapabilityRegistry } from '../pluginHost/capabilities'
import { loadTask } from '../worktrees/taskWorktree'
import { getProjectConfig } from '../projectConfig'

// Which loopback ports a task legitimately serves on, for the preview tunnel's allowlist
// (server/transport/tunnel.ts, docs/api-reference.md § WebSocket). Derived, never configured: a port is
// tunnellable exactly when the owner has told the node something serves on it.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

// The port a URL implies, when the URL is loopback. Explicit ports plus the two scheme defaults,
// because a dev server on 80 or 443 is unusual but legal.
export function loopbackPortOf(url: string | undefined | null): number | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return null
  if (parsed.port) {
    const port = Number(parsed.port)
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
  }
  return parsed.protocol === 'https:' ? 443 : parsed.protocol === 'http:' ? 80 : null
}

export function declaredTunnelPorts(db: AppDatabase, capabilities?: Pick<CapabilityRegistry, 'get'>) {
  return async (taskId: string): Promise<readonly number[]> => {
    const ports = new Set<number>()
    const add = (url: string | undefined | null): void => {
      const port = loopbackPortOf(url)
      if (port) ports.add(port)
    }

    // Source 1: every run target's fixed `url`, because a layout recipe's browser URL may point to a
    // target that is not the default.
    //
    // `get`, not `require`. A node whose terminal plugin is disabled has no run bridge, and the
    // answer there is "no run-target port", not a thrown upgrade.
    const bridge = (capabilities?.get(RUN_TARGETS) ?? routeTestCapabilityFor(RUN_TARGETS)) as RunBridge | undefined
    if (bridge) {
      add(await bridge.defaultUrl(taskId).catch(() => undefined))
      const resolved = await bridge.targets(taskId).catch(() => null)
      // `targets` is typed `unknown` on the bridge, since the route projects it verbatim. Read the
      // fields defensively rather than importing the terminal plugin's shape into core.
      const list = (resolved as { targets?: { url?: unknown }[] } | null)?.targets
      if (Array.isArray(list)) for (const target of list) if (typeof target?.url === 'string') add(target.url)
    }

    // Source 2, resolved through the task's project, so a caller cannot name a project it has no task
    // in. The upgrade handler already scope-checks the taskId.
    const task = await loadTask(db, taskId).catch(() => null)
    if (task?.projectId) {
      const config = (await getProjectConfig(db, task.projectId))?.config
      const value = (config?.previewValue ?? '').trim()
      if (config?.previewMode === 'port') {
        const port = Number(value)
        if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.add(port)
      }
      // `previewMode: 'url'` is also a source (docs/api-reference.md § WebSocket).
      if (config?.previewMode === 'url') add(value)
    }

    return [...ports]
  }
}
