import type { CoreServices } from '@acorn/plugin-api/node'
import type { DiffItem } from '../shared/guide'
import { parseDiff } from './diff'

export type Change = { baseRef: string; baseSha: string; headSha: string; items: DiffItem[] }

/** A failure the pane shows as it is. */
export class ChangeError extends Error {}

// Git refuses a branch name holding any of these, and a colon would make the fetch below write a ref.
const BRANCH = /^[^-\s:][^\s:]*$/

/**
 * The change a task's worktree makes against its change request's target branch: fetch that branch,
 * find where HEAD leaves it, and split the diff from there to HEAD. Read from the worktree, never from
 * a code host, so every host takes the same path.
 */
export async function readChange(git: Pick<CoreServices['git'], 'git'>, cwd: string, baseRef: string): Promise<Change> {
  if (!BRANCH.test(baseRef)) throw new ChangeError(`"${baseRef}" isn't a branch name Acorn can fetch.`)
  const run = async (args: string[]) => {
    const result = await git.git(args, { cwd })
    return result.code === 0 && !result.truncated ? result.stdout : null
  }
  // A failed fetch, such as offline, leaves the last fetched copy, which is still a usable base.
  await run(['fetch', '--no-tags', 'origin', `refs/heads/${baseRef}`])
  const baseSha = (await run(['merge-base', `refs/remotes/origin/${baseRef}`, 'HEAD']))?.trim()
  if (!baseSha) throw new ChangeError(`Couldn't find where this branch leaves origin/${baseRef}.`)
  const headSha = (await run(['rev-parse', 'HEAD']))?.trim()
  if (!headSha) throw new ChangeError("Couldn't read the worktree's HEAD.")
  // Explicit prefixes and no text conversion, so a person's diff settings can't change what's parsed.
  const diff = await run([
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-U3',
    baseSha,
    headSha,
  ])
  if (diff === null) throw new ChangeError("Couldn't read the diff. It may be too large for a guide.")
  return { baseRef, baseSha, headSha, items: parseDiff(diff) }
}
