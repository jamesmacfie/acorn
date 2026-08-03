// The API panel's request executor. Runs in the Hono server, which is a plain Node process (under
// Electron via apps/desktop's main/bootstrap.ts, otherwise via apps/node's server/standalone.ts) — so this needs no
// bridge. A bridge exists to hold a stateful Node handle (a pg.Pool, a PTY); fetch is stateless.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, and } from 'drizzle-orm'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import { buildSessionEnv, type SessionTaskInfo } from '@acorn/node-core/main/taskEnv.ts'
import { httpVariables } from '../node/schema'
import {
  applyAuth,
  defaultContentType,
  interpolate,
  joinUrl,
  missingVars,
  serializeBody,
  splitUrl,
  type AuthConfig,
  type HttpSendInput,
  type SendFailure,
  type SendResult,
  type TimelineEntry,
} from '../shared/model'
import { openHttpValue } from './storage'

// What this module needs from core, now that it has no handle to core's database: resolve the execution
// task and its worktree, find the repo's primary checkout for the fallback cwd, and open its own
// ciphertext. `tasks.root` is passed the request's identity because creating a worktree consults that
// login's per-repo base-ref preference.
export type SendCoreServices = Pick<CoreServices, 'tasks' | 'repos' | 'secrets'>

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

// CLIs emit colour even when their stdout is a pipe.
const ANSI = /\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g
const lastLine = (stdout: string): string | null => stdout.replace(ANSI, '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? null

// Command variables are executable, so resolve only names the request actually references. A
// per-request override also shadows the repo variable before execution; precedence must not mean
// "run a lower layer for its side effects, then discard it".
export function referencedVariableNames(input: HttpSendInput): Set<string> {
  const fields = [input.url]
  for (const header of input.headers) {
    if (header.enabled && header.name) fields.push(header.name, header.value)
  }
  if (input.bodyMode !== 'none') fields.push(input.body)
  switch (input.auth.mode) {
    case 'basic':
      fields.push(input.auth.username, input.auth.password)
      break
    case 'bearer':
      fields.push(input.auth.token)
      break
    case 'apikey':
      fields.push(input.auth.key, input.auth.value)
      break
    case 'none':
      break
  }
  return new Set(fields.flatMap((field) => missingVars(field, {})))
}

// --- variable resolution ------------------------------------------------------------------

/**
 * Flattens every variable layer into one lookup for interpolation.
 * Precedence, lowest first: task builtins < repo variables < per-request overrides.
 *
 * `command` variables persist the user's shell command, then run it at send time without persisting
 * its output — the same mechanism the Database pane uses for `dbUrlScript`
 * (plugins/database/main/database.ts). Unlike that one there is no repo-config trust gate here:
 * these commands are typed by the user into the app's own DB, not read from a committed
 * .acorn/config.toml, so there is no repo-authored code to authorize.
 */
type ResolvedVariables = { values: Record<string, string>; sensitiveValues: string[] }

async function resolveVarsWithSensitivity(
  db: PluginDatabase,
  core: SendCoreServices,
  userId: string,
  repoOwner: string,
  repoName: string,
  input: HttpSendInput,
): Promise<ResolvedVariables> {
  const vars: Record<string, string> = {}

  // Builtins from the task, so a request can point at this task's worktree/branch.
  let cwd: string | null = null
  let taskInfo: SessionTaskInfo | null = null
  if (input.executionTaskId) {
    const task = await core.tasks.load(input.executionTaskId)
    if (!task) throw new SendError('The task used to send this request no longer exists')
    if (task.repoOwner !== repoOwner || task.repoName !== repoName) {
      throw new SendError(`The selected task belongs to ${task.repoOwner}/${task.repoName}, not ${repoOwner}/${repoName}`)
    }
    // taskRoot is null until a worktree exists (and always under dev:node) — fall back to the
    // repo checkout, exactly as resolveDbUrl and the preview resolver do.
    cwd = (await core.tasks.root(input.executionTaskId, userId)) ?? null
    vars.repo = `${task.repoOwner}/${task.repoName}`
    vars.branch = task.branch
    vars.taskId = task.id
    taskInfo = { repoOwner: task.repoOwner, repoName: task.repoName, branch: task.branch, title: task.title }
  }
  if (!cwd) cwd = (await core.repos.path(repoOwner, repoName))?.path ?? null
  if (cwd) vars.worktree = cwd

  const rows = await db
    .select()
    .from(httpVariables)
    .where(and(eq(httpVariables.userId, userId), eq(httpVariables.repoOwner, repoOwner), eq(httpVariables.repoName, repoName)))
  const referenced = referencedVariableNames(input)
  const enabled = rows.filter((r) => r.enabled && referenced.has(r.name) && !(r.name in input.vars))

  const opened = new Map<string, string>()
  for (const row of enabled) {
    try {
      opened.set(row.id, await openHttpValue(row.value, row.encrypted, core.secrets))
    } catch {
      throw new SendError(`Variable "${row.name}" could not be decrypted — re-enter its value`)
    }
  }

  for (const row of enabled) {
    if (row.kind === 'value') vars[row.name] = opened.get(row.id)!
  }

  // Commands run concurrently under one shared deadline.
  const commands = enabled.filter((r) => r.kind === 'command')
  if (commands.length) {
    if (!cwd) throw new SendError('Command variables need a repo checkout — set the repo path first')
    const env = buildSessionEnv({ taskId: input.executionTaskId ?? '', cwd, task: taskInfo })
    const deadline = AbortSignal.timeout(ALL_COMMANDS_TIMEOUT_MS)
    const results = await Promise.all(
      commands.map(async (row) => {
        try {
          // bash -lc, not /bin/sh -c: a login shell picks up nvm/rbenv/direnv shims, which is what
          // makes `op read …` or `mise exec …` work the way it does in the user's own terminal.
          const { stdout } = await exec('bash', ['-lc', opened.get(row.id)!], { cwd, env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER, signal: deadline })
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

  for (const row of enabled) {
    if (row.kind === 'secret') vars[row.name] = opened.get(row.id)!
  }

  // Per-request overrides win over repo variables, by design.
  for (const [name, value] of Object.entries(input.vars)) vars[name] = value
  return {
    values: vars,
    // Secret variables and command outputs never originated in renderer state. Track their
    // plaintext only for response redaction; value-kind and per-request overrides are already
    // visible in the editable draft.
    sensitiveValues: enabled.filter((row) => row.kind !== 'value').map((row) => vars[row.name]).filter(Boolean),
  }
}

export async function resolveVars(
  db: PluginDatabase,
  core: SendCoreServices,
  userId: string,
  repoOwner: string,
  repoName: string,
  input: HttpSendInput,
): Promise<Record<string, string>> {
  return (await resolveVarsWithSensitivity(db, core, userId, repoOwner, repoName, input)).values
}

// --- execution ----------------------------------------------------------------------------

/**
 * Turns a draft plus resolved variables into the exact request to put on the wire.
 * Split out from send() so it is testable without a database or a network — this is where the
 * interpolation, the auth compilation and the scheme check all land.
 */
export function buildRequest(input: HttpSendInput, vars: Record<string, string>): { target: URL; headers: Headers; body: string | undefined } {
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

export function describeFetchFailure(err: unknown, target: URL): Pick<SendFailure, 'error' | 'code' | 'detail'> {
  const nodes = errorNodes(err)
  const code = nodes.map((node) => stringField(node, 'code')).find(Boolean) ?? null
  const detail =
    nodes
      .map((node) => stringField(node, 'message'))
      .find((message) => message && message !== 'fetch failed' && message !== 'request failed') ?? null
  const timedOut = nodes.some((node) => stringField(node, 'name') === 'TimeoutError') || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT'

  if (timedOut) return { error: `Connection to ${target.host} timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`, code, detail }
  if (code === 'ECONNREFUSED') {
    return { error: `Connection refused by ${target.host}. The server may not be running or may be listening on a different port.`, code, detail }
  }
  if (code === 'ENOTFOUND') return { error: `Could not find ${target.hostname}. Check the host name or DNS.`, code, detail }
  if (code === 'EAI_AGAIN') return { error: `DNS lookup for ${target.hostname} did not complete. Try again.`, code, detail }
  if (code === 'ECONNRESET') return { error: `The connection to ${target.host} was reset before a response arrived.`, code, detail }
  if (code === 'ECONNABORTED') return { error: `The connection to ${target.host} was closed before a response arrived.`, code, detail }
  if (code && /(CERT|SELF_SIGNED|TLS|SSL|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER)/.test(code)) {
    return { error: `TLS certificate validation failed for ${target.host}.`, code, detail }
  }
  return {
    error: detail ?? `The request to ${target.host} failed before an HTTP response arrived.`,
    code,
    detail: null,
  }
}

export async function send(
  db: PluginDatabase,
  core: SendCoreServices,
  userId: string,
  repoOwner: string,
  repoName: string,
  input: HttpSendInput,
): Promise<SendResult> {
  const resolved = await resolveVarsWithSensitivity(db, core, userId, repoOwner, repoName, input)
  const { target, headers, body } = buildRequest(input, resolved.values)

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
    const durationMs = Date.now() - started
    const described = describeFetchFailure(err, target)
    const failure = {
      error: redactResolved(described.error, resolved.sensitiveValues),
      code: described.code,
      detail: described.detail ? redactResolved(described.detail, resolved.sensitiveValues) : null,
    }
    return {
      ok: false,
      ...failure,
      url: redactResolved(target.toString(), resolved.sensitiveValues),
      durationMs,
      timeline: buildFailureTimeline(input.method, target.toString(), headers, failure, durationMs, resolved.sensitiveValues),
    }
  }

  const { bytes, truncated } = await readCapped(res)
  const durationMs = Date.now() - started

  return {
    ok: true,
    status: res.status,
    statusText: res.statusText,
    url: redactResolved(res.url || target.toString(), resolved.sensitiveValues),
    redirected: res.redirected,
    headers: [...res.headers.entries()],
    // Base64 so a binary response survives the JSON hop intact; the renderer decodes it and picks a
    // view from the content-type.
    bodyBase64: Buffer.from(bytes).toString('base64'),
    size: bytes.byteLength,
    truncated,
    durationMs,
    timeline: buildTimeline(input.method, target.toString(), headers, res, durationMs, bytes.byteLength, truncated, resolved.sensitiveValues),
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  (typeof value === 'object' && value !== null) || typeof value === 'function' ? (value as Record<string, unknown>) : null

const stringField = (value: unknown, field: string): string | null => {
  const record = asRecord(value)
  return record && typeof record[field] === 'string' ? record[field] : null
}

// Node's fetch usually wraps the useful system error in `cause`; dual-stack connection failures
// may use AggregateError.errors instead. Flatten both shapes without depending on undici internals.
function errorNodes(value: unknown): unknown[] {
  const pending: unknown[] = [value]
  const seen = new Set<unknown>()
  const out: unknown[] = []
  while (pending.length) {
    const current = pending.shift()
    if (current === null || current === undefined || seen.has(current)) continue
    seen.add(current)
    out.push(current)
    const record = asRecord(current)
    if (!record) continue
    if (record.cause !== null && record.cause !== undefined) pending.push(record.cause)
    if (Array.isArray(record.errors)) pending.push(...record.errors)
  }
  return out
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
function buildTimeline(
  method: string,
  url: string,
  sent: Headers,
  res: Response,
  durationMs: number,
  size: number,
  truncated: boolean,
  sensitiveValues: string[],
): TimelineEntry[] {
  const out = buildRequestTimeline(method, url, sent, sensitiveValues)
  if (res.redirected && res.url && res.url !== url) out.push({ label: 'info', detail: `redirected to ${redactResolved(res.url, sensitiveValues)}` })
  out.push({ label: 'response', detail: `${res.status} ${res.statusText}` })
  for (const [k, v] of res.headers.entries()) out.push({ label: 'response-header', detail: `${k}: ${v}` })
  out.push({ label: 'info', detail: `${size} bytes in ${durationMs}ms${truncated ? ' (body truncated at 5 MB)' : ''}` })
  return out
}

function buildFailureTimeline(
  method: string,
  url: string,
  sent: Headers,
  failure: Pick<SendFailure, 'error' | 'code' | 'detail'>,
  durationMs: number,
  sensitiveValues: string[],
): TimelineEntry[] {
  const out = buildRequestTimeline(method, url, sent, sensitiveValues)
  out.push({ label: 'error', detail: `${failure.error}${failure.code ? ` [${failure.code}]` : ''}` })
  if (failure.detail && failure.detail !== failure.error) out.push({ label: 'error-detail', detail: failure.detail })
  out.push({ label: 'info', detail: `failed after ${durationMs}ms without an HTTP response` })
  return out
}

function buildRequestTimeline(method: string, url: string, sent: Headers, sensitiveValues: string[]): TimelineEntry[] {
  const out: TimelineEntry[] = [{ label: 'request', detail: `${method} ${redactResolved(url, sensitiveValues)}` }]
  for (const [k, v] of sent.entries()) out.push({ label: 'request-header', detail: `${k}: ${redact(k, redactResolved(v, sensitiveValues))}` })
  return out
}

// The timeline is shown in the UI and copied into bug reports; a resolved secret variable must not
// ride along in it.
const SENSITIVE = new Set(['authorization', 'proxy-authorization', 'cookie'])
const redact = (name: string, value: string): string => (SENSITIVE.has(name.toLowerCase()) ? `${value.split(' ')[0]} ••••••` : value)

function redactResolved(input: string, sensitiveValues: string[]): string {
  let output = input
  for (const value of sensitiveValues) {
    for (const form of new Set([value, encodeURIComponent(value)])) {
      if (form) output = output.split(form).join('••••••')
    }
  }
  return output
}

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
