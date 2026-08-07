import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db/index'
import { schema } from '../server/db/index'
import { getRunBridge } from '../server/routes/harness'
import { loadTask } from './taskWorktree'

// Which loopback ports a task legitimately serves on, for the preview tunnel's allowlist
// (main/tunnel.ts). protocol.md § Streams: "Only declared ports; no general SOCKS."
//
// **Derived, never configured.** There is no new setting here on purpose: a port is tunnellable exactly
// when the owner has already told the node something serves on it. Two sources, both of which the preview
// pane itself reads:
//
//   1. the default run target's URL, which the run bridge resolves (a fixed `url`, or one discovered from a
//      running instance's `url_command` output);
//   2. the repo's `previewMode: 'port'` value.
//
// `previewMode: 'script'` is deliberately NOT a source. Its value is a shell command whose stdout is the
// URL, and running it to answer an upgrade would mean executing repo config on every tunnel attempt — the
// config-trust gate exists precisely to stop that being incidental. A repo using a URL script still gets a
// tunnel: the pane resolves the script through its own (gated) route and the resulting port comes back
// through source 1 when it is a run target, or the owner sets `previewMode: 'port'`.
//
// A URL naming a host other than loopback contributes nothing: it is already reachable from the client, so
// there is nothing to tunnel, and treating it as a port to open would be the SOCKS hole.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

// The port a URL implies, when the URL is loopback. Explicit ports only plus the two scheme defaults —
// a dev server on 80 or 443 is unusual but legal, and refusing it would be an arbitrary hole.
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

export function declaredTunnelPorts(db: AppDatabase) {
  return async (taskId: string): Promise<readonly number[]> => {
    const ports = new Set<number>()

    // Source 1. `get`, not `require`: a node whose terminal plugin is disabled has no run bridge, and the
    // honest answer there is "no run-target port", not a thrown upgrade.
    const fromRun = await getRunBridge()?.defaultUrl(taskId).catch(() => undefined)
    const runPort = loopbackPortOf(fromRun)
    if (runPort) ports.add(runPort)

    // Source 2. Resolved through the task's repo, so a caller cannot name a repo it has no task in — the
    // taskId is already scope-checked by the upgrade handler.
    const task = await loadTask(db, taskId).catch(() => null)
    if (task) {
      const [row] = await db
        .select({ previewMode: schema.repoPaths.previewMode, previewValue: schema.repoPaths.previewValue })
        .from(schema.repoPaths)
        .where(and(eq(schema.repoPaths.owner, task.repoOwner), eq(schema.repoPaths.repo, task.repoName)))
        .limit(1)
      if (row?.previewMode === 'port') {
        const port = Number((row.previewValue ?? '').trim())
        if (Number.isInteger(port) && port >= 1 && port <= 65535) ports.add(port)
      }
    }

    return [...ports]
  }
}
