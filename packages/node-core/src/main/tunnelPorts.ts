import type { AppDatabase } from '../server/db/index'
import { RUN_TARGETS, type RunBridge } from '../server/routes/harness'
import { routeTestCapabilityFor } from '../server/bridge'
import type { CapabilityRegistry } from '../server/plugin/capabilities'
import { loadTask } from './taskWorktree'
import { getProjectConfig } from './projectConfig'

// Which loopback ports a task legitimately serves on, for the preview tunnel's allowlist
// (main/tunnel.ts, docs/api-reference.md § WebSocket). Derived, never configured: there is no new
// setting here, because a port is tunnellable exactly when the owner has already told the node
// something serves on it.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

// The port a URL implies, when the URL is loopback. Explicit ports only, plus the two scheme
// defaults: a dev server on 80 or 443 is unusual but legal, and refusing it would be an arbitrary
// hole.
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

    // Source 1: every run target's fixed `url`, not just the default one's, because a layout recipe's
    // browser URL may point to a non-default target.
    //
    // `get`, not `require`: a node whose terminal plugin is disabled has no run bridge, and the honest
    // answer there is "no run-target port", not a thrown upgrade.
    const bridge = (capabilities?.get(RUN_TARGETS) ?? routeTestCapabilityFor(RUN_TARGETS)) as RunBridge | undefined
    if (bridge) {
      add(await bridge.defaultUrl(taskId).catch(() => undefined))
      const resolved = await bridge.targets(taskId).catch(() => null)
      // `targets` is typed `unknown` on the bridge (the route projects it verbatim), so this reads the two
      // fields it needs defensively rather than importing the terminal plugin's shape into core.
      const list = (resolved as { targets?: { url?: unknown }[] } | null)?.targets
      if (Array.isArray(list)) for (const target of list) if (typeof target?.url === 'string') add(target.url)
    }

    // Source 2. Resolved through the task's project, so a caller cannot name a project it has no task
    // in: the taskId is already scope-checked by the upgrade handler.
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
