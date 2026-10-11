import { lstat } from 'node:fs/promises'
import { resolveInRoot } from '@acorn/plugin-api/node'
import type { LocalChange } from '@acorn/protocol/localGit.ts'

const STAMP_WORKERS = 8

// Every admitted projection reads its own fresh stamps. A bounded worker roster limits outstanding
// filesystem requests and preserves porcelain order without joining projections across mutations.
export async function stampLocalChanges(worktree: string, changes: readonly LocalChange[]): Promise<LocalChange[]> {
  const results = new Array<LocalChange>(changes.length)
  let next = 0
  const worker = async () => {
    while (next < changes.length) {
      const index = next++
      const change = changes[index]!
      if (change.staged || change.contentKey == null) results[index] = change
      else {
        const stamp = await diskStamp(worktree, change)
        results[index] = { ...change, contentKey: stamp == null ? undefined : `${change.contentKey} ${stamp}`.trim() }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(STAMP_WORKERS, changes.length) }, worker))
  return results
}

// ctime detects edits that restore size and mtime. Modes detect chmod. These stamps never enter
// the two-second Git text cache, and submodule entries retain the unknown-key fallback.
async function diskStamp(worktree: string, change: LocalChange): Promise<string | undefined> {
  try {
    const full = resolveInRoot(worktree, change.path)
    if (!full) return undefined
    const stat = await lstat(full)
    return `${stat.mode} ${stat.size} ${stat.mtimeMs} ${stat.ctimeMs}`
  } catch {
    return change.status === 'deleted' ? 'gone' : undefined
  }
}
