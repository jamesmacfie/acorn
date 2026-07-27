// The API panel's request executor. Runs in the Hono server, which is a plain Node process (under
// Electron via app/main/bootstrap.ts, under `dev:node` via app/server/devNode.ts) — so this needs no
// bridge. A bridge exists to hold a stateful Node handle (a pg.Pool, a PTY); fetch is stateless.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, and } from 'drizzle-orm'
import type { AppDatabase } from '../../../core/server/db'
import * as schema from '../../../core/server/db/schema'
import { decryptSecret } from '../../../core/server/session'
import { loadTask, taskRoot } from '../../../core/main/taskWorktree'
import { getRepoPath } from '../../../core/main/repoPaths'
import { buildSessionEnv, type SessionTaskInfo } from '../../../core/main/taskEnv'
import {
  applyAuth,
  defaultContentType,
  interpolate,
  joinUrl,
  serializeBody,
  splitUrl,
  type AuthConfig,
  type BodyMode,
  type KeyValue,
  type SendResult,
  type TimelineEntry,
} from '../shared/model'

const exec = promisify(execFile)

// Caps. The response cap protects the renderer (the body is base64'd into JSON); the command cap
// bounds a variable script that decides to print a file.
const MAX_BODY_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 15_000
const COMMAND_MAX_BUFFER = 1 << 20
// All command variables together get one budget — N vars × 15s serial would hang a send.
const ALL_COMMANDS_TIMEOUT_MS = 30_000

export class SendError extends Error {}

export type SendInput = {
  method: string
  url: string
  headers: KeyValue[]
  bodyMode: BodyMode
  body: string
  auth: AuthConfig
  vars: Record<string, string> // per-request overrides (plain values only)
  taskId: string | null
}

// CLIs emit colour even when their stdout is a pipe.
const ANSI = /\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g
const lastLine = (stdout: string): string | null => stdout.replace(ANSI, '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? null

// --- variable resolution ------------------------------------------------------------------

/**
 * Flattens every variable layer into one lookup for interpolation.
 * Precedence, lowest first: task builtins < repo variables < per-request overrides.
 *
 * `command` variables run a shell at send time and are never persisted — the same mechanism the
 * Database pane uses for `dbUrlScript` (plugins/database/main/database.ts). Unlike that one there is
 * no repo-config trust gate here: these commands are typed by the user into the app's own DB, not
 * read from a committed .acorn/config.toml, so there is no repo-authored code to authorize.
 */
export async function resolveVars(db: AppDatabase, repoOwner: string, repoName: string, encKey: string | undefined, input: SendInput): Promise<Record<string, string>> {
  const vars: Record<string, string> = {}

  // Builtins from the task, so a request can point at this task's worktree/branch.
  let cwd: string | null = null
  let taskInfo: SessionTaskInfo | null = null
  if (input.taskId) {
    const task = await loadTask(db, input.taskId)
    // taskRoot is null until a worktree exists (and always under dev:node) — fall back to the
    // repo checkout, exactly as resolveDbUrl and the preview resolver do.
    cwd = (await taskRoot(db, input.taskId)) ?? null
    if (task) {
      vars.repo = `${task.repoOwner}/${task.repoName}`
      vars.branch = task.branch
      vars.taskId = task.id
      taskInfo = { repoOwner: task.repoOwner, repoName: task.repoName, branch: task.branch, title: task.title }
    }
  }
  if (!cwd) cwd = (await getRepoPath(db, repoOwner, repoName))?.path ?? null
  if (cwd) vars.worktree = cwd

  const rows = await db
    .select()
    .from(schema.httpVariables)
    .where(and(eq(schema.httpVariables.repoOwner, repoOwner), eq(schema.httpVariables.repoName, repoName)))
  const enabled = rows.filter((r) => r.enabled)

  for (const row of enabled) {
    if (row.kind === 'value') vars[row.name] = row.value
  }

  // Secrets: decryptSecret returns null for anything it can't open (notably after a key rotation).
  // Fail loudly — a null must never end up in an Authorization header as "undefined".
  for (const row of enabled.filter((r) => r.kind === 'secret')) {
    if (!encKey) throw new SendError(`Cannot read secret variable "${row.name}": no session key`)
    const plain = await decryptSecret(row.value, encKey)
    if (plain === null) throw new SendError(`Secret variable "${row.name}" could not be decrypted — re-enter its value`)
    vars[row.name] = plain
  }

  // Commands run concurrently under one shared deadline.
  const commands = enabled.filter((r) => r.kind === 'command')
  if (commands.length) {
    if (!cwd) throw new SendError('Command variables need a repo checkout — set the repo path first')
    const env = buildSessionEnv({ taskId: input.taskId ?? '', cwd, task: taskInfo })
    const deadline = AbortSignal.timeout(ALL_COMMANDS_TIMEOUT_MS)
    const results = await Promise.all(
      commands.map(async (row) => {
        try {
          // bash -lc, not /bin/sh -c: a login shell picks up nvm/rbenv/direnv shims, which is what
          // makes `op read …` or `mise exec …` work the way it does in the user's own terminal.
          const { stdout } = await exec('bash', ['-lc', row.value], { cwd, env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER, signal: deadline })
          const line = lastLine(stdout)
          if (line === null) throw new SendError(`Variable "${row.name}": command produced no output`)
          return [row.name, line] as const
        } catch (err) {
          if (err instanceof SendError) throw err
          throw new SendError(`Variable "${row.name}": ${err instanceof Error ? err.message : 'command failed'}`)
        }
      }),
    )
    for (const [name, value] of results) vars[name] = value
  }

  // Per-request overrides win over repo variables, by design.
  for (const [name, value] of Object.entries(input.vars)) vars[name] = value
  return vars
}

// --- execution ----------------------------------------------------------------------------

/**
 * Turns a draft plus resolved variables into the exact request to put on the wire.
 * Split out from send() so it is testable without a database or a network — this is where the
 * interpolation, the auth compilation and the scheme check all land.
 */
export function buildRequest(input: SendInput, vars: Record<string, string>): { target: URL; headers: Headers; body: string | undefined } {
  // Interpolate per field, never over a serialized request — a value containing a delimiter would
  // otherwise reshape the request rather than fill a slot.
  const applied = applyAuth(interpolateAuth(input.auth, vars))

  const { base, params } = splitUrl(interpolate(input.url, vars))
  const url = joinUrl(base, [...params, ...applied.queryParams])

  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new SendError(`Not a valid URL: ${url}`)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new SendError(`Only http and https are supported (got ${target.protocol})`)
  }

  const headers = new Headers()
  for (const h of [...input.headers, ...applied.headers]) {
    if (h.enabled && h.name) headers.append(interpolate(h.name, vars), interpolate(h.value, vars))
  }

  const body = serializeBody(input.bodyMode, interpolate(input.body, vars))
  const contentType = defaultContentType(input.bodyMode)
  // Only default it — an explicit Content-Type header always wins.
  if (body !== undefined && contentType && !headers.has('content-type')) headers.set('content-type', contentType)

  return { target, headers, body }
}

export async function send(db: AppDatabase, repoOwner: string, repoName: string, encKey: string | undefined, input: SendInput): Promise<SendResult> {
  const vars = await resolveVars(db, repoOwner, repoName, encKey, input)
  const { target, headers, body } = buildRequest(input, vars)

  const started = Date.now()
  let res: Response
  try {
    res = await fetch(target, {
      method: input.method,
      headers,
      body,
      // redirect: 'follow' (the default) rather than a hand-rolled hop loop: undici already strips
      // Authorization on a cross-origin redirect, and reimplementing that wrongly leaks the token.
      // The cost is per-hop timeline rows; `redirected` + the final url cover the common question.
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err instanceof Error ? err.message : 'request failed'
    throw new SendError(reason)
  }

  const { bytes, truncated } = await readCapped(res)
  const durationMs = Date.now() - started

  return {
    status: res.status,
    statusText: res.statusText,
    url: res.url || target.toString(),
    redirected: res.redirected,
    headers: [...res.headers.entries()],
    // Base64 so a binary response survives the JSON hop intact; the renderer decodes it and picks a
    // view from the content-type.
    bodyBase64: Buffer.from(bytes).toString('base64'),
    size: bytes.byteLength,
    truncated,
    durationMs,
    timeline: buildTimeline(input.method, target.toString(), headers, res, durationMs, bytes.byteLength, truncated),
  }
}

// Read the body a chunk at a time so a huge or endless response can't exhaust memory — the cap has
// to be enforced while streaming, not after arrayBuffer() has already buffered it all.
export async function readCapped(res: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(0), truncated: false }
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (total + value.byteLength > MAX_BODY_BYTES) {
        chunks.push(value.subarray(0, MAX_BODY_BYTES - total))
        total = MAX_BODY_BYTES
        truncated = true
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return { bytes, truncated }
}

// A chronological log of what went out and what came back, in Bruno's spirit but without its
// https.Agent subclass — no DNS/TCP/TLS phase breakdown.
function buildTimeline(method: string, url: string, sent: Headers, res: Response, durationMs: number, size: number, truncated: boolean): TimelineEntry[] {
  const out: TimelineEntry[] = [{ label: 'request', detail: `${method} ${url}` }]
  for (const [k, v] of sent.entries()) out.push({ label: 'request-header', detail: `${k}: ${redact(k, v)}` })
  if (res.redirected && res.url && res.url !== url) out.push({ label: 'info', detail: `redirected to ${res.url}` })
  out.push({ label: 'response', detail: `${res.status} ${res.statusText}` })
  for (const [k, v] of res.headers.entries()) out.push({ label: 'response-header', detail: `${k}: ${v}` })
  out.push({ label: 'info', detail: `${size} bytes in ${durationMs}ms${truncated ? ' (body truncated at 5 MB)' : ''}` })
  return out
}

// The timeline is shown in the UI and copied into bug reports; a resolved secret variable must not
// ride along in it.
const SENSITIVE = new Set(['authorization', 'proxy-authorization', 'cookie'])
const redact = (name: string, value: string): string => (SENSITIVE.has(name.toLowerCase()) ? `${value.split(' ')[0]} ••••••` : value)

function interpolateAuth(auth: AuthConfig, vars: Record<string, string>): AuthConfig {
  const i = (s: string) => interpolate(s, vars)
  switch (auth.mode) {
    case 'basic':
      return { mode: 'basic', username: i(auth.username), password: i(auth.password) }
    case 'bearer':
      return { mode: 'bearer', token: i(auth.token) }
    case 'apikey':
      return { mode: 'apikey', key: i(auth.key), value: i(auth.value), placement: auth.placement }
    case 'none':
      return auth
  }
}
