import { git } from '@acorn/plugin-api/node'
import type { PushOptions } from '../../shared/changes/api'

/** Validate the person-observed lease before the Changes owner runs its push hook and Git write. */
export async function forceLeaseRefusal(worktree: string, options: PushOptions): Promise<string | null> {
  if (!options.expectedBranch || !/^[0-9a-f]{40,64}$/.test(options.expectedRemoteId ?? ''))
    return 'Refresh Changes before force pushing. The observed remote commit is required.'
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: worktree, maxOutputBytes: 1024 })
  if (branch.code !== 0 || branch.stdout.trim() !== options.expectedBranch) return 'Task branch changed. Refresh Changes before force pushing.'
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd: worktree, maxOutputBytes: 1024 })
  if (upstream.code !== 0 || upstream.stdout.trim() !== `origin/${options.expectedBranch}`) return 'Force push requires the matching origin upstream.'
  return null
}
