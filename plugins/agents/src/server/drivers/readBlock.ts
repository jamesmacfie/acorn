import { lstatSync, readFileSync, readdirSync } from 'node:fs'
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

/** Files in a writable git folder that make git run a program or read a different repository. The
 *  Node runs git in the worktree unsandboxed, for every status refresh, so a hook, an `fsmonitor` or
 *  `hooksPath` setting, or a repointed `.git` file written here would run as the person. Claude Code
 *  protects only `hooks` and `config` inside the working directory's own `.git` folder. */
export function gitControlFiles(git: string): string[] {
  return [
    ...['config', 'config.worktree', 'hooks'].map((name) => join(git, name)),
    ...['config.worktree', 'commondir', 'gitdir'].map((name) => join(git, 'worktrees', '*', name)),
    ...['config', 'hooks'].map((name) => join(git, 'modules', '**', name)),
  ]
}

/** Every path under `dir` that holds none of `kept`, at the shallowest level that does. An entry on
 *  the way to a kept path is opened instead, so its other children, such as other tasks' worktrees or
 *  the plugin databases beside a plugin's skill folder, are still hidden. */
function hiddenBeside(dir: string, kept: readonly string[]): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.map((entry) => join(dir, entry)).flatMap((path) => {
    if (!kept.some((keep) => within(keep, path))) return [path]
    if (kept.includes(path)) return []
    try {
      return lstatSync(path).isDirectory() ? hiddenBeside(path, kept) : []
    } catch {
      return []
    }
  })
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
    // A linked worktree's `.git` file names the folder git reads, so it's denied too. A plain `.git`
    // folder stays writable, because a commit writes inside it.
    writeDenied: git
      ? [join(resolve(input.worktree), '.git'), ...gitControlFiles(git)]
      : gitControlFiles(join(resolve(input.worktree), '.git')),
    hidden: hiddenBeside(dataDir, workspace),
    loopback,
  }
}
