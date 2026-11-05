// Clone runs: clone a Git URL into a folder on this machine in the background, then register the
// folder as a project (docs/workspaces-and-tasks/clone-runs.md). The route answers as
// soon as a run starts, because a large clone outlasts any one request.
//
// Process-local, like archive runs (../storage/archiveRuns.ts). A restart drops every record, and the
// hidden folder of a clone it interrupted stays on disk under a name that says what it is.
import { randomUUID } from 'node:crypto'
import { readdir, rename, rm, rmdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { CLONE_RUN_WAIT_MS, type CloneResult, type CloneRun } from '@acorn/protocol/api.ts'
import { eq } from 'drizzle-orm'
import { schema, type AppDatabase } from '../db'
import { gitOrThrow } from '../core/git'
import { createLogger, describeError } from '../telemetry/logger'
import { createProject, updateProjectRef, type ProjectUpdateRefInput } from './projects'

const log = createLogger('clone')

export type ProjectCloneInput = {
  url: string
  // An absolute folder that exists on this Node. The clone goes in `<parentDir>/<name>`.
  parentDir: string
  // Defaults to the URL's last path segment, without `.git`.
  name?: string
  workspaceId?: string
  // A project with no folder yet, such as an importer's placeholder, to give the clone to instead of
  // creating a row.
  fillProjectId?: string
  // Written to the row as soon as it has its folder, before the run reports finished.
  fields?: Omit<ProjectUpdateRefInput, 'path'>
  // False for a URL the owner pasted (docs/workspaces-and-tasks/projects.md § Untrusted projects).
  // Omitted means trusted, which is what an importer's clone stays.
  trusted?: boolean
}

export type CloneContext = {
  db: AppDatabase
  ownerId: string
  // A loaded plugin's id, so `fields` can set an external id only on a host it holds.
  holder?: string
  // Tests add `file` to clone a local bare repository. Production code never passes this.
  protocols?: readonly string[]
}

const CLONE_PROTOCOLS = ['https', 'ssh'] as const
const CLONE_TIMEOUT_MS = 30 * 60_000
// An importer can start up to a hundred clones at once.
const MAX_RUNNING = 3
// Long enough for every client waiting on the clone to read its outcome.
const KEEP_FINISHED_MS = 10 * 60_000

const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\//i
// Git's scp form. A user is required, which keeps a Windows drive path and `ext::` out of it.
const SCP_URL = /^([^@/:]+)@([^@/:]+):(.+)$/

/** The folder a URL clones into by default, or why the URL may not be cloned. The URL reaches
 *  `git clone` as given, so this is what stops one that names a local path, runs a command through a
 *  remote helper, or hands ssh an option. */
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
  return folderNameProblem(folder) ? { error: `${url} doesn't name a repository folder.` } : { folder }
}

const folderNameProblem = (name: string): boolean => !name || name === '.' || name === '..' || /[/\\\p{Cc}]/u.test(name)

const isDirectory = (path: string): Promise<boolean> =>
  stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  )

// A missing folder, or an empty one, is a fair place to clone into. A file is not.
const isFreeTarget = (path: string): Promise<boolean> =>
  readdir(path).then(
    (entries) => entries.length === 0,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  )

type Run = { startedAt: number; result?: CloneResult; finishedAt?: number; done: Promise<void> }
const runs = new Map<string, Run>()
const shutdown = new AbortController()
let running = 0
const queued: Array<() => void> = []

function prune(): void {
  const cutoff = Date.now() - KEEP_FINISHED_MS
  for (const [id, run] of runs) if (run.finishedAt !== undefined && run.finishedAt < cutoff) runs.delete(id)
}

async function inSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running < MAX_RUNNING) running++
  else await new Promise<void>((resolve) => queued.push(resolve))
  try {
    return await work()
  } finally {
    // Hands this slot straight to the next clone, so `running` stays put.
    const next = queued.shift()
    if (next) next()
    else running--
  }
}

/** Checks the URL and the target folder, then starts the clone. A refusal comes back here, before git
 *  runs. Everything after that is the run's outcome. */
export async function startCloneRun(
  input: ProjectCloneInput,
  context: CloneContext,
): Promise<{ ok: true; cloneId: string } | { ok: false; error: string }> {
  const url = checkCloneUrl(input.url, context.protocols)
  if ('error' in url) return { ok: false, error: url.error }
  const name = input.name?.trim() || url.folder
  if (folderNameProblem(name)) return { ok: false, error: `${JSON.stringify(name)} can't be a folder name.` }
  if (!isAbsolute(input.parentDir)) return { ok: false, error: 'The parent folder must be an absolute path.' }
  if (!(await isDirectory(input.parentDir)))
    return { ok: false, error: `${input.parentDir} doesn't exist on this Node.` }
  const target = join(input.parentDir, name)
  if (!(await isFreeTarget(target))) return { ok: false, error: `${target} already exists and isn't empty.` }

  prune()
  const cloneId = randomUUID()
  const run: Run = { startedAt: Date.now(), done: Promise.resolve() }
  run.done = inSlot(() => cloneAndRegister(cloneId, input, name, context))
    .catch((error: unknown): CloneResult => {
      const { message } = describeError(error)
      log.warn(`clone of ${input.url} failed: ${message}`)
      return { ok: false, error: message }
    })
    .then((result) => {
      run.result = result
      run.finishedAt = Date.now()
    })
  runs.set(cloneId, run)
  return { ok: true, cloneId }
}

async function cloneAndRegister(
  cloneId: string,
  input: ProjectCloneInput,
  name: string,
  context: CloneContext,
): Promise<CloneResult> {
  shutdown.signal.throwIfAborted()
  const target = join(input.parentDir, name)
  // Beside the target, so the rename below never crosses a filesystem, and the target never holds
  // half a clone.
  const hidden = join(input.parentDir, `.${name}.acorn-clone-${cloneId}`)
  try {
    await gitOrThrow(['clone', '--quiet', '--no-recurse-submodules', '--', input.url, hidden], {
      cwd: input.parentDir,
      timeoutMs: CLONE_TIMEOUT_MS,
      signal: shutdown.signal,
      env: {
        // A redirect or a submodule can't switch to another transport. This wins over the same
        // variable in the Node's own environment.
        GIT_ALLOW_PROTOCOL: (context.protocols ?? CLONE_PROTOCOLS).join(':'),
        GIT_LFS_SKIP_SMUDGE: '1',
      },
    })
    // Windows can't rename onto an empty folder. rmdir refuses one that filled up meanwhile.
    await rmdir(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await rename(hidden, target)
  } catch (error) {
    await rm(hidden, { recursive: true, force: true })
    throw error
  }
  try {
    return { ok: true, projectId: await register(target, input, context) }
  } catch (error) {
    // The folder stays: it holds a complete clone, and a row may already point at it.
    return {
      ok: false,
      error: `Cloned into ${target}, but couldn't add it as a project: ${describeError(error).message} Add the folder as a project, or delete it and clone again.`,
    }
  }
}

async function register(target: string, input: ProjectCloneInput, context: CloneContext): Promise<string> {
  if (input.fillProjectId) {
    const filled = await updateProjectRef(
      context.db,
      input.fillProjectId,
      { ...input.fields, path: target },
      context.holder,
    )
    if (!filled) throw new Error('The project this clone was for no longer exists.')
    return filled.id
  }
  const created = await createProject(
    context.db,
    { path: target, name: input.name, workspaceId: input.workspaceId, trusted: input.trusted },
    context.ownerId,
  )
  if (!created.ok) throw new Error(created.reason)
  // A row that already named this empty folder was trusted for whatever used to be there.
  if (input.trusted === false && created.project.trusted)
    await context.db.update(schema.projects).set({ trusted: false }).where(eq(schema.projects.id, created.project.id))
  if (input.fields) await updateProjectRef(context.db, created.project.id, input.fields, context.holder)
  return created.project.id
}

/** The run's state, after waiting up to `waitMs`, capped at CLONE_RUN_WAIT_MS, for it to finish. */
export async function cloneRunState(cloneId: string, waitMs: number): Promise<CloneRun> {
  prune()
  const run = runs.get(cloneId)
  if (!run) return { state: 'none' }
  const wait = Math.min(Math.max(waitMs, 0), CLONE_RUN_WAIT_MS)
  if (!run.result && wait > 0) {
    let timer: NodeJS.Timeout | undefined
    await Promise.race([run.done, new Promise((resolve) => (timer = setTimeout(resolve, wait)))])
    clearTimeout(timer)
  }
  return run.result
    ? { state: 'finished', result: run.result }
    : { state: 'running', elapsedMs: Date.now() - run.startedAt }
}

/** Stops every clone, running or queued, when the Node shuts down, and waits while each one fails and
 *  deletes its hidden folder. */
export async function stopCloneRuns(): Promise<void> {
  shutdown.abort()
  await Promise.all([...runs.values()].map((run) => run.done))
}
