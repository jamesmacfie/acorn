// The Docker panel in the browser extension's sidebar (docs/docker.md § Surfaces): a task's containers,
// their published ports, and one container's recent logs, as the fixed blocks of `BrowserPanelView`.
// Pure, so tests need no daemon. The bridge lists the containers and reads the log lines.
import type { BrowserPanelBlock, BrowserPanelView } from '@acorn/protocol/plugin/handoffs.ts'
import type { DockerContainerSummary } from '../shared/model'

type Severity = 'info' | 'warn' | 'danger' | 'pending'

export const PANEL_LOG_LINES = 200
// The host refuses an answer over 512 KiB, so leave room under it.
const PANEL_MAX_BYTES = 480 * 1024
const WORST: readonly Severity[] = ['danger', 'warn', 'pending', 'info']

const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text)
const nameOf = (c: DockerContainerSummary): string => c.composeService ?? c.name
// The daemon's status text, such as "Exited (1) 2 minutes ago", is the only place health shows: the
// events watcher drops health events as noise.
const statusOf = (c: DockerContainerSummary): string => c.status || c.state || 'unknown'

function severityOf(c: DockerContainerSummary): Severity {
  const exitCode = /^Exited \((\d+)\)/.exec(c.status)?.[1]
  if (c.state === 'dead' || (exitCode !== undefined && exitCode !== '0') || c.status.includes('(unhealthy)'))
    return 'danger'
  if (c.state === 'created' || c.state === 'restarting' || c.status.includes('(health: starting)')) return 'pending'
  if (c.state === 'paused') return 'warn'
  return 'info'
}

// Compose names containers `<project>-<service>-<n>`, so the ID outlives a recreated container, and the
// sidebar's remembered choice with it.
export const sourceIdOf = (c: DockerContainerSummary): string =>
  cut(
    c.name
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/^[^a-z0-9]+/, ''),
    64,
  ) || 'container'

const ordered = (containers: readonly DockerContainerSummary[]): DockerContainerSummary[] =>
  [...containers].sort(
    (a, b) => (a.composeProject ?? '').localeCompare(b.composeProject ?? '') || nameOf(a).localeCompare(nameOf(b)),
  )

/** The container whose logs show: the one `source` names, else the first failing one, the first running
 *  one, or the first. */
export function logContainer(
  containers: readonly DockerContainerSummary[],
  source: string | null,
): DockerContainerSummary | undefined {
  const list = ordered(containers)
  return (
    list.find((c) => sourceIdOf(c) === source) ??
    list.find((c) => severityOf(c) === 'danger') ??
    list.find((c) => c.state === 'running') ??
    list[0]
  )
}

/** `logs` is the picked container and its lines, or none when the task has no containers. */
export function dockerBrowserPanel(
  containers: readonly DockerContainerSummary[],
  logs: { container: DockerContainerSummary; lines: readonly string[] } | null,
): BrowserPanelView {
  const list = ordered(containers)
  const blocks: BrowserPanelBlock[] = []
  if (!list.length) return { blocks }

  const severities = list.map(severityOf)
  const detail = list.flatMap((c, i) => (severities[i] === 'info' ? [] : [`${nameOf(c)}: ${statusOf(c)}`]))
  if (list.some((c) => c.workingDirMissing)) detail.push('The worktree behind this stack is gone.')
  blocks.push({
    kind: 'status',
    label: 'Containers',
    state: `${list.filter((c) => c.state === 'running').length} of ${list.length} running`,
    severity: WORST.find((s) => severities.includes(s)) ?? 'info',
    ...(detail.length ? { detail: cut(detail.join('\n'), 2_000) } : {}),
  })

  blocks.push({
    kind: 'rows',
    title: 'Containers',
    rows: list
      .slice(0, 64)
      .map((c, i) => ({ label: cut(nameOf(c), 80), state: cut(statusOf(c), 40), severity: severities[i] })),
  })

  const links = list
    .flatMap((c) =>
      c.ports
        .filter((p) => p.hostPort !== null && p.protocol === 'tcp')
        .map((p) => ({
          label: cut(`${nameOf(c)} ${p.containerPort}`, 40),
          url: `http://localhost:${p.hostPort}`,
          ready: c.state === 'running',
        })),
    )
    .slice(0, 16)
  if (links.length) blocks.push({ kind: 'links', title: 'Ports', links })

  if (logs) {
    const logBlock = {
      kind: 'logs' as const,
      title: 'Logs',
      sources: list.slice(0, 32).map((c) => ({ id: sourceIdOf(c), label: cut(nameOf(c), 40) })),
      source: sourceIdOf(logs.container),
      lines: logs.lines.slice(-PANEL_LOG_LINES).map((line) => cut(line, 1_000)),
    }
    blocks.push(logBlock)
    // Drop the oldest lines until the view fits. Each line costs its JSON text and a comma.
    let over = Buffer.byteLength(JSON.stringify({ blocks })) - PANEL_MAX_BYTES
    let drop = 0
    while (over > 0 && drop < logBlock.lines.length)
      over -= Buffer.byteLength(JSON.stringify(logBlock.lines[drop++])) + 1
    logBlock.lines.splice(0, drop)
  }
  return { blocks }
}
