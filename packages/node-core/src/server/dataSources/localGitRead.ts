import { worktreeStatusText } from '../worktrees/worktreeStatus'

export type WorktreeCounts = { modifiedCount: number; untrackedCount: number; changed: boolean }

/** Uses the same coalesced porcelain read as the changes pane and the task rail. */
export async function worktreeCounts(path: string): Promise<WorktreeCounts | null> {
  const text = await worktreeStatusText(path)
  if (text === null) return null
  const lines = text.split('\n').filter(line => line && !line.startsWith('#'))
  const untrackedCount = lines.filter(line => line.startsWith('? ')).length
  const modifiedCount = lines.length - untrackedCount
  return { modifiedCount, untrackedCount, changed: lines.length > 0 }
}
