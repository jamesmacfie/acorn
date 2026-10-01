import { readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CoreProcService } from '@acorn/plugin-api/node'

// What Settings > Storage and memory measures for this plugin (docs/managed-agents.md § Operations and
// failure): the memory of each provider process tree, and the size of the two folders this plugin
// writes under the data root.

export type ProcessRow = { pid: number; ppid: number; rssBytes: number }

/** Every process on the machine with its parent and resident memory, or null where `ps` is missing,
 *  fails, or says more than the cap. Through the broker, like every other short-lived child. `-A`
 *  rather than `-ax`, because both macOS and Linux read it as "every process". RSS is in KiB on both. */
export async function listProcesses(proc: Pick<CoreProcService, 'runProcess'>): Promise<ProcessRow[] | null> {
  if (process.platform === 'win32') return null
  const result = await proc.runProcess({
    file: 'ps',
    args: ['-A', '-o', 'pid=,ppid=,rss='],
    cwd: tmpdir(),
    timeoutMs: 5_000,
    maxOutputBytes: 8 * 1024 * 1024,
  }).catch(() => null)
  if (!result || result.code !== 0 || result.truncated) return null
  return parseProcessTable(result.stdout)
}

export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number)
    if (Number.isInteger(pid) && Number.isInteger(ppid) && Number.isFinite(rss)) {
      rows.push({ pid, ppid, rssBytes: rss * 1024 })
    }
  }
  return rows
}

/** The resident memory of each root and all of its descendants, each process counted once. A root that
 *  has already exited adds nothing. RSS counts shared pages in every process and misses compressed
 *  ones on macOS, so this is an estimate. */
export function processTreeBytes(rows: readonly ProcessRow[], roots: readonly number[]): number {
  const children = new Map<number, ProcessRow[]>()
  const byPid = new Map<number, ProcessRow>()
  for (const row of rows) {
    byPid.set(row.pid, row)
    const siblings = children.get(row.ppid)
    if (siblings) siblings.push(row)
    else children.set(row.ppid, [row])
  }
  const seen = new Set<number>()
  let total = 0
  const pending = roots.filter((pid) => byPid.has(pid))
  while (pending.length) {
    const pid = pending.pop()!
    if (seen.has(pid)) continue
    seen.add(pid)
    total += byPid.get(pid)!.rssBytes
    for (const child of children.get(pid) ?? []) pending.push(child.pid)
  }
  return total
}

/** The bytes of every file under `path`, or 0 when it does not exist. */
export async function directoryBytes(path: string): Promise<number> {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await directoryBytes(child)
    else if (entry.isFile()) total += await stat(child).then((info) => info.size, () => 0)
  }
  return total
}
