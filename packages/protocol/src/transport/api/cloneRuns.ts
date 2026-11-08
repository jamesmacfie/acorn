// Clone runs: the Node clones a Git URL in the background and registers the folder as a project
// (docs/workspaces-and-tasks/clone-runs.md). A clone can take far longer than one
// request may, so a client starts it with a POST and reads the outcome with GETs.

export type CloneResult = { ok: true; projectId: string } | { ok: false; error: string }

// What the Node knows about one clone. `none` means it holds no record: the ID is wrong, the Node
// restarted since, or the finished answer expired.
export type CloneRun =
  | { state: 'running'; elapsedMs: number }
  | { state: 'finished'; result: CloneResult }
  | { state: 'none' }

export type CloneRunStart = { cloneId: string; state: 'running' }

// Beside the clone types rather than with the other project routes, so a client loads them with the
// clone form and not at startup.
export const projectCloneRunsRoute = '/v1/core/projects/clone-runs'
export const projectCloneRunRoute = (cloneId: string) => `${projectCloneRunsRoute}/${encodeURIComponent(cloneId)}`

// The longest a client asks the Node to hold one wait open. It stays under the broker's 30-second
// request deadline.
export const CLONE_RUN_WAIT_MS = 20_000

const LOST_CLONE =
  'The Node lost track of this clone, which happens when it restarts. Check the folder, then clone again or add it as a project.'

/** Waits for a clone the caller has started, one bounded request at a time. */
export async function cloneOutcome(wait: () => Promise<CloneRun>): Promise<CloneResult> {
  let run = await wait()
  while (run.state === 'running') run = await wait()
  return run.state === 'finished' ? run.result : { ok: false, error: LOST_CLONE }
}

export const CLONE_PROTOCOLS = ['https', 'ssh'] as const

const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\//i
// Git's scp form. A user is required, which keeps a Windows drive path and `ext::` out of it.
const SCP_URL = /^([^@/:]+)@([^@/:]+):(.+)$/

/** The folder a URL clones into by default, or why the URL may not be cloned. The URL reaches
 *  `git clone` as given, so this is what stops one that names a local path, runs a command through a
 *  remote helper, or hands ssh an option. The Node runs it before every clone, and the clone form runs
 *  it as you type, so both say the same thing. */
export function checkCloneUrl(
  url: string,
  protocols: readonly string[] = CLONE_PROTOCOLS,
): { folder: string } | { error: string } {
  if (!url || /[\s\p{Cc}]/u.test(url)) return { error: "A Git URL can't contain spaces or control characters." }
  let user: string
  let host: string
  let path: string
  let password = ''
  const scheme = SCHEME_URL.exec(url)?.[1]!.toLowerCase()
  if (scheme) {
    if (!protocols.includes(scheme)) return { error: `Acorn clones https and ssh Git URLs, not ${scheme}.` }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { error: `${url} isn't a URL Acorn can read.` }
    }
    if (parsed.search || parsed.hash) return { error: 'Remove the query or fragment from the Git URL.' }
    user = parsed.username
    password = parsed.password
    host = parsed.hostname
    path = parsed.pathname.replace(/^\//, '')
  } else {
    const scp = SCP_URL.exec(url)
    if (!scp) return { error: `${url} isn't an https, ssh, or user@host:path Git URL.` }
    ;[, user, host, path] = scp as unknown as [string, string, string, string]
  }
  if (password)
    return {
      error:
        "Leave the password or token out of the Git URL, because Git saves the URL in the clone's settings as plain text. Use a credential helper or an SSH key.",
    }
  if ([user, host, path].some((part) => part.startsWith('-')))
    return { error: 'The user, host, and path in a Git URL can\'t start with "-".' }
  const folder = path
    .replace(/\/+$/, '')
    .split('/')
    .pop()!
    .replace(/\.git$/i, '')
  return cloneFolderProblem(folder) ? { error: `${url} doesn't name a repository folder.` } : { folder }
}

/** Whether `name` can't be the clone's folder: empty, a dot path, or holding a separator. */
export const cloneFolderProblem = (name: string): boolean =>
  !name || name === '.' || name === '..' || /[/\\\p{Cc}]/u.test(name)
