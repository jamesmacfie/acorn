import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { AgentDriverReadBlock } from './types'

// What a session confined to its own work may still reach (docs/managed-agents/read-block.md). The
// data root holds every session's token file, the task database, and the TLS key, and it also holds
// the session's own worktree, token file, and skill folders, so the block is the data root minus those.

const within = (path: string, root: string): boolean => path === root || path.startsWith(root + sep)

/** The repository's shared git folder for a linked worktree, where a commit writes its objects and
 *  refs. A linked worktree's `.git` is a file naming its own git folder, whose `commondir` names the
 *  shared one. Null when `.git` is a folder inside the worktree, which the agent can write anyway. */
export function sharedGitDir(worktree: string): string | null {
  let text: string
  try {
    text = readFileSync(join(worktree, '.git'), 'utf8')
  } catch {
    return null
  }
  const gitdir = /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()
  if (!gitdir) return null
  const own = resolve(worktree, gitdir)
  try {
    return resolve(own, readFileSync(join(own, 'commondir'), 'utf8').trim())
  } catch {
    return own
  }
}

export function dataRootReadBlock(input: {
  dataDir: string
  worktree: string
  env: Record<string, string>
  /** The skill folders and plugin folders this start hands the harness. */
  skillPaths: readonly string[]
}): AgentDriverReadBlock {
  const dataDir = resolve(input.dataDir)
  const git = sharedGitDir(input.worktree)
  // What the agent works in. Its token file and the Node's certificate are read by the task CLI, never
  // by the model, so they stay out of this list and their folders stay hidden from the file tools.
  const workspace = [input.worktree, ...input.skillPaths, ...(git ? [git] : [])].map((path) => resolve(path))
  const credentials = [input.env.ACORN_API_TOKEN_FILE, input.env.NODE_EXTRA_CA_CERTS].filter((path): path is string => !!path)
  let entries: string[] = []
  try {
    entries = readdirSync(dataDir)
  } catch {
    // No root yet means nothing in it to hide.
  }
  let loopback: string | null = null
  try {
    loopback = new URL(input.env.ACORN_API_URL ?? '').host || null
  } catch {
    // No listener address yet. The task CLI then can't reach the Node from the sandbox.
  }
  return {
    dataDir,
    readable: [...new Set([...workspace, ...credentials])],
    writable: git ? [git] : [],
    hidden: entries.map((entry) => join(dataDir, entry)).filter((entry) => !workspace.some((path) => within(path, entry))),
    loopback,
  }
}
