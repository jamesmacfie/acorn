import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { AgentDriverReadBlock } from './types'

// What a session confined to its own work may still reach (docs/managed-agents/read-block.md). The
// data root holds every session's token file, the task database, and the TLS key, and it also holds
// the session's own worktree, token file, and skill folders, so the block is the data root minus those.
// The client folders, where the CLI and other clients keep the owner's device tokens as plain files,
// are blocked the same way.

const within = (path: string, root: string): boolean => path === root || path.startsWith(root + sep)

/** A linked worktree's two git folders: its own, named by the worktree's `.git` file, and the
 *  repository's shared one, named by the own folder's `commondir`. Null when `.git` is a folder inside
 *  the worktree. */
export function linkedGitDirs(worktree: string): { own: string; shared: string } | null {
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
    return { own, shared: resolve(own, readFileSync(join(own, 'commondir'), 'utf8').trim()) }
  } catch {
    return { own, shared: own }
  }
}

/** Where a sandboxed commit may write, and the git files it may not. The Node runs git in the worktree
 *  unsandboxed for every status refresh, so a hook, an `fsmonitor` or `hooksPath` setting, a submodule's
 *  config, or a repointed `.git` or `commondir` written by the agent would run as the person.
 *
 *  Concrete paths only, because on Linux the sandbox skips a write entry with a wildcard. Claude Code
 *  grants a linked worktree's shared git folder itself and protects some of these files on its own,
 *  but not a submodule's config or hooks, so the list names each one rather than relying on it. A
 *  worktree created after this start is protected only by Claude Code's own rules. */
export function gitWrites(worktree: string): { writable: string[]; writeDenied: string[] } {
  const linked = linkedGitDirs(worktree)
  // A plain `.git` folder is denied as a whole. Inside the worktree, an agent could otherwise write its
  // `commondir` to send git to another config, or rename it and leave a `.git` file pointing anywhere,
  // and a deny on a file inside can't stop a rename of the folder. Commits fail in such a session.
  if (!linked) return { writable: [], writeDenied: [join(worktree, '.git')] }
  const { own, shared } = linked
  let worktrees: string[] = []
  try {
    worktrees = readdirSync(join(shared, 'worktrees')).map((name) => join(shared, 'worktrees', name))
  } catch {
    // No other worktrees.
  }
  return {
    writable: [...['objects', 'refs', 'logs'].map((name) => join(shared, name)), own],
    writeDenied: [
      join(worktree, '.git'),
      ...['config', 'config.worktree', 'hooks', 'modules'].map((name) => join(shared, name)),
      ...[...new Set([own, ...worktrees])].flatMap((dir) =>
        ['commondir', 'gitdir', 'config.worktree'].map((name) => join(dir, name)),
      ),
    ],
  }
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
  return entries
    .map((entry) => join(dir, entry))
    .flatMap((path) => {
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
  /** Folders outside the data root to block the same way (`clientCustodyDirs`). */
  clientDirs: readonly string[]
  worktree: string
  env: Record<string, string>
  /** The skill folders and plugin folders this start hands the harness. */
  skillPaths: readonly string[]
  /** The session's copies of the attachments its turns sent (`AgentAttachmentStore`). */
  attachments: string
  fileGuard: AgentDriverReadBlock['fileGuard']
}): AgentDriverReadBlock {
  const dataDir = resolve(input.dataDir)
  const worktree = resolve(input.worktree)
  const git = linkedGitDirs(worktree)?.shared
  // What the agent works in. Its token file, the Node's certificate, and `node.json`, where the task CLI
  // finds the Node's current port, are read by the task CLI, never by the model, so they stay out of
  // this list and stay hidden from the file tools.
  const workspace = [worktree, ...input.skillPaths, input.attachments, ...(git ? [git] : [])].map((path) =>
    resolve(path),
  )
  const credentials = [
    input.env.ACORN_API_TOKEN_FILE,
    input.env.NODE_EXTRA_CA_CERTS,
    input.env.ACORN_DATA_DIR && join(input.env.ACORN_DATA_DIR, 'node.json'),
  ].filter((path): path is string => !!path)
  let loopback: string | null = null
  try {
    loopback = new URL(input.env.ACORN_API_URL ?? '').host || null
  } catch {
    // No listener address yet. The task CLI then can't reach the Node from the sandbox.
  }
  // The file guard checks every client folder, so one a client makes after the start is covered too.
  const clientDirs = [...new Set(input.clientDirs.map((dir) => resolve(dir)))]
  const kept = [...workspace, dataDir]
  // The sandbox denies an existing client folder whole, or, when it holds the worktree or the data root,
  // the entries beside them, so it never stacks a second deny above the paths it opens again. The
  // installed desktop's own folder is the second kind.
  const clientReadDenied = clientDirs
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => (kept.some((path) => within(path, dir)) ? hiddenBeside(dir, kept) : [dir]))
  return {
    dataDir,
    clientDirs,
    clientReadDenied,
    worktree,
    readable: [...new Set([...workspace, ...credentials])],
    ...gitWrites(worktree),
    hidden: [
      ...new Set([...hiddenBeside(dataDir, workspace), ...clientDirs.flatMap((dir) => hiddenBeside(dir, kept))]),
    ],
    loopback,
    fileGuard: input.fileGuard,
  }
}
