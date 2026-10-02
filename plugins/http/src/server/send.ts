// The API panel's request executor runs in the HTTP plugin's isolated Node worker. Short-lived
// commands use the host process broker so they run in the task's worktree without worker permissions.
import { eq, and } from 'drizzle-orm'
import { buildSessionEnv, type CoreServices, type PluginDatabase, type SessionTaskInfo } from '@acorn/plugin-api/node'
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
import { readCapped } from './responseBody'

// Resolve the execution task and worktree, find the project's fallback checkout, open stored values,
// and run command variables through the host process broker.
export type SendCoreServices = Pick<CoreServices, 'tasks' | 'projects' | 'secrets' | 'proc'>

// Caps. The response cap protects the client (the body is base64'd into JSON); the command cap
// bounds a variable script that decides to print a file.
const REQUEST_TIMEOUT_MS = 30_000
const COMMAND_TIMEOUT_MS = 15_000
const COMMAND_MAX_BUFFER = 1 << 20

export class SendError extends Error {}

// CLIs emit colour even when their stdout is a pipe.
const ANSI = /\x1b(?:\[[0-9;]*[A-Za-z]|\(B)/g
const lastLine = (stdout: string): string | null => stdout.replace(ANSI, '').split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? null

// Only resolves the names a request references (docs/http-client.md § Sending). A command variable's
// value comes from running its shell command, so precedence must not mean running a lower layer for
// its side effects, then discarding it.
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
 * Flattens every variable layer into one lookup for interpolation (docs/http-client.md § Sending).
 */
type ResolvedVariables = { values: Record<string, string>; sensitiveValues: string[] }

async function resolveVarsWithSensitivity(
  db: PluginDatabase,
  core: SendCoreServices,
  userId: string,
  projectId: string,
  input: HttpSendInput,
  signal: AbortSignal,
): Promise<ResolvedVariables> {
  signal.throwIfAborted()
  const vars: Record<string, string> = {}

  // Builtins from the task, so a request can point at this task's worktree/branch.
  let cwd: string | null = null
  let taskInfo: SessionTaskInfo | null = null
  if (input.executionTaskId) {
    const task = await checked(core.tasks.load(input.executionTaskId), signal)
    if (!task) throw new SendError('The task used to send this request no longer exists')
    const project = task.projectId ? await checked(core.projects.byId(task.projectId), signal) : null
    if (task.projectId !== projectId) {
      throw new SendError(`The selected task belongs to ${project?.name ?? task.projectId ?? 'another project'}, not this project`)
    }
    // taskRoot is null until a worktree exists (and always under dev:node); fall back to the
    // project checkout, exactly as resolveDbUrl and the preview resolver do.
    cwd = (await checked(core.tasks.root(input.executionTaskId), signal)) ?? null
    if (project) {
      vars.projectId = project.id
      vars.project = project.name
    }
    if (project?.github) vars.repo = `${project.github.owner}/${project.github.name}`
    if (task.branch) vars.branch = task.branch
    vars.taskId = task.id
    if (project) taskInfo = { projectId: project.id, projectName: project.name, github: project.github, branch: task.branch, title: task.title }
  }
  if (!cwd) cwd = (await checked(core.projects.byId(projectId), signal))?.path ?? null
  if (cwd) vars.worktree = cwd

  const rows = await db
    .select()
    .from(httpVariables)
    .where(and(eq(httpVariables.userId, userId), eq(httpVariables.projectId, projectId)))
  signal.throwIfAborted()
  const referenced = referencedVariableNames(input)
  const enabled = rows.filter((r) => r.enabled && referenced.has(r.name) && !(r.name in input.vars))

  const opened = new Map<string, string>()
  for (const row of enabled) {
    try {
      opened.set(row.id, await checked(openHttpValue(row.value, row.encrypted, core.secrets), signal))
    } catch {
      signal.throwIfAborted()
      throw new SendError(`Variable "${row.name}" could not be decrypted — re-enter its value`)
    }
  }

  for (const row of enabled) {
    if (row.kind === 'value') vars[row.name] = opened.get(row.id)!
  }

  // Commands run concurrently, so each command's timeout also bounds the whole group.
  const commands = enabled.filter((r) => r.kind === 'command')
  if (commands.length) {
    if (!cwd) throw new SendError('Command variables need a project checkout — set the project path first')
    const env = buildSessionEnv({ taskId: input.executionTaskId ?? '', cwd, task: taskInfo })
    const group = new AbortController()
    const commandSignal = AbortSignal.any([signal, group.signal])
    const pending = commands.map(async (row) => {
        try {
          // bash -lc, not /bin/sh -c: a login shell picks up nvm/rbenv/direnv shims, which is what
          // makes `op read …` or `mise exec …` work the way it does in the user's own terminal.
          // The host broker runs outside this plugin's permission-scoped worker. A child spawned in
          // the worker inherits its Node permissions and cannot load a CLI outside the plugin bundle.
          commandSignal.throwIfAborted()
          const result = await core.proc.runProcess({
            file: 'bash', args: ['-lc', opened.get(row.id)!], cwd, env,
            timeoutMs: COMMAND_TIMEOUT_MS, maxOutputBytes: COMMAND_MAX_BUFFER, signal: commandSignal,
          })
          commandSignal.throwIfAborted()
          if (result.aborted) throw new SendError(`Variable "${row.name}": command canceled`)
          if (result.spawnError) throw new SendError(`Variable "${row.name}": command could not start`)
          if (result.timedOut) throw new SendError(`Variable "${row.name}": command timed out after ${COMMAND_TIMEOUT_MS / 1000} seconds`)
          if (result.truncated) throw new SendError(`Variable "${row.name}": command produced more than ${COMMAND_MAX_BUFFER} bytes of output`)
          if (result.code !== 0) {
            // Command diagnostics can include private values that have not resolved successfully.
            throw new SendError(`Variable "${row.name}": command exited ${result.code}`)
          }
          const line = lastLine(result.stdout)
          if (line === null) throw new SendError(`Variable "${row.name}": command produced no output`)
          return [row.name, line] as const
        } catch (err) {
          commandSignal.throwIfAborted()
          if (err instanceof SendError) throw err
          throw new SendError(`Variable "${row.name}": command failed`)
        }
      })
    let results: (readonly [string, string])[]
    try { results = await Promise.all(pending) }
    finally {
      group.abort()
      await Promise.allSettled(pending)
    }
    signal.throwIfAborted()
    for (const [name, value] of results) vars[name] = value
  }

  for (const row of enabled) {
    if (row.kind === 'secret') vars[row.name] = opened.get(row.id)!
  }

  // Per-request overrides win over project variables.
  for (const [name, value] of Object.entries(input.vars)) vars[name] = value
  return {
    values: vars,
    // Secret variables and command outputs never originated in client state. Track their
    // plaintext only for response redaction; value-kind and per-request overrides are already
    // visible in the editable draft.
    sensitiveValues: enabled.filter((row) => row.kind !== 'value').map((row) => vars[row.name]).filter(Boolean),
  }
}

export async function resolveVars(
  db: PluginDatabase,
  core: SendCoreServices,
  userId: string,
  projectId: string,
  input: HttpSendInput,
  signal = new AbortController().signal,
): Promise<Record<string, string>> {
  return (await resolveVarsWithSensitivity(db, core, userId, projectId, input, signal)).values
}

// --- execution ----------------------------------------------------------------------------

/**
 * Turns a draft plus resolved variables into the exact request to put on the wire.
 * Split out from send() so it is testable without a database or a network. This is where the
 * interpolation, the auth compilation and the scheme check all land.
 */
export function buildRequest(input: HttpSendInput, vars: Record<string, string>): { target: URL; headers: Headers; body: string | undefined } {
  // Interpolate per field, never over a serialized request (docs/http-client.md § Sending).
  const applied = applyAuth(interpolateAuth(input.auth, vars))

  const { base, params } = splitUrl(interpolate(input.url, vars))
  const url = joinUrl(base, [...params, ...applied.queryParams])

  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw new SendError('Not a valid URL. Check the URL and its referenced variables.')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new SendError('Only http and https URLs are supported.')
  }

  const headers = new Headers()
  try {
    for (const h of [...input.headers, ...applied.headers]) {
      if (h.enabled && h.name) headers.append(interpolate(h.name, vars), interpolate(h.value, vars))
    }
  } catch {
    throw new SendError('Request headers are invalid. Check header names and values for unsupported characters.')
  }

  const body = serializeBody(input.bodyMode, interpolate(input.body, vars))
  const contentType = defaultContentType(input.bodyMode)
  // Only default it: an explicit Content-Type header always wins.
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
  projectId: string,
  input: HttpSendInput,
  caller = new AbortController().signal,
): Promise<SendResult> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new DOMException('Request timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
  const signal = AbortSignal.any([caller, deadline.signal])
  try { return await sendWithinDeadline(db, core, userId, projectId, input, signal, caller) }
  catch (error) {
    caller.throwIfAborted()
    if (deadline.signal.aborted) throw new SendError(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
    throw error
  }
  finally { clearTimeout(timer) }
}

async function checked<T>(pending: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const result = await pending
  signal.throwIfAborted()
  return result
}

async function sendWithinDeadline(
  db: PluginDatabase, core: SendCoreServices, userId: string, projectId: string,
  input: HttpSendInput, signal: AbortSignal, caller: AbortSignal,
): Promise<SendResult> {
  const resolved = await resolveVarsWithSensitivity(db, core, userId, projectId, input, signal)
  let prepared: ReturnType<typeof buildRequest>
  try {
    prepared = buildRequest(input, resolved.values)
  } catch (error) {
    // URL and Headers validation must never escape with the resolved URL or header value.
    if (error instanceof SendError) throw error
    throw new SendError('The request could not be built. Check its URL, headers, body, and authentication settings.')
  }
  const { target, headers, body } = prepared

  const started = Date.now()
  let res: Response
  try {
    res = await fetch(target, {
      method: input.method,
      headers,
      body,
      // redirect: 'follow' (docs/http-client.md § Sending).
      redirect: 'follow',
      signal,
    })
  } catch (err) {
    caller.throwIfAborted()
    const durationMs = Date.now() - started
    const described = describeFetchFailure(err, target)
    const failure = {
      error: redactResolved(described.error, resolved.sensitiveValues),
      code: described.code ? redactResolved(described.code, resolved.sensitiveValues) : null,
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

  const { bytes, truncated } = await readCapped(res, signal)
  const durationMs = Date.now() - started

  return {
    ok: true,
    status: res.status,
    statusText: res.statusText,
    url: redactResolved(res.url || target.toString(), resolved.sensitiveValues),
    redirected: res.redirected,
    headers: [...res.headers.entries()],
    // Base64 so a binary response survives the JSON hop intact; the client decodes it and picks a
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
  for (const [k, v] of sent.entries()) out.push({ label: 'request-header', detail: `${redactResolved(k, sensitiveValues)}: ${redact(k, redactResolved(v, sensitiveValues))}` })
  return out
}

// The timeline is shown in the UI and copied into bug reports; a resolved secret variable must not
// ride along in it.
const SENSITIVE = new Set(['authorization', 'proxy-authorization', 'cookie'])
const redact = (name: string, value: string): string => (SENSITIVE.has(name.toLowerCase()) ? `${value.split(' ')[0]} ••••••` : value)

function redactResolved(input: string, sensitiveValues: string[]): string {
  let output = input
  for (const value of [...sensitiveValues].sort((a, b) => b.length - a.length)) {
    // Transport diagnostics can quote form encodings, whose spaces become '+' and whose
    // punctuation escaping differs from this executor's encodeURIComponent serialization.
    const formValue = new URLSearchParams({ value }).toString().slice('value='.length)
    // URL hosts and header names normalize ASCII case. Include that known normalization rather
    // than assuming exact raw text survives request compilation.
    const forms = [value, encodeURIComponent(value), formValue]
    for (const form of new Set([...forms, ...forms.map((form) => form.toLowerCase())])) {
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
