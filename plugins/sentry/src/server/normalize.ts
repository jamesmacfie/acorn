// Sentry payload normalization: a strict allowlist, so only the fields below ever reach the client
// (docs/security/renderer.md § Untrusted provider data). Every string is stripped of control
// characters and capped. Everything else is dropped, including the user, the request, breadcrumbs,
// contexts, tags other than the environment, and each frame's local variables.
//
// Pure and network-free, so tests run it against synthetic payloads only.
import { isRecord } from '@acorn/plugin-api/node'
import type { SentryEvent, SentryIssueDetail, SentryIssueSummary, SentryStackFrame } from '../shared/api'

// The same kinds of caps as Rollbar's. Exported so tests assert against the same numbers.
export const CAPS = {
  exceptions: 10,
  framesTotal: 200,
  codeLinesPerFrame: 7,
  maxStringBytes: 8 * 1024,
  maxDetailBytes: 192 * 1024,
} as const

// eslint-disable-next-line no-control-regex -- this matches C0 controls, to strip them.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

// Drop control characters (keeping \n and \t), then cap by bytes. An empty result is null, so an
// optional field stays null rather than "".
function cleanString(value: unknown, max = CAPS.maxStringBytes): string | null {
  if (typeof value !== 'string') return null
  let s = value.replace(CONTROL, '')
  if (!s) return null
  if (Buffer.byteLength(s, 'utf8') > max) s = `${Buffer.from(s, 'utf8').subarray(0, max).toString('utf8')}…`
  return s
}

const asString = (value: unknown): string | null =>
  value == null || typeof value === 'object' ? null : cleanString(String(value))
const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
// Sentry sends `count` as a string and `userCount` as a number.
const asCount = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0
}
// Only an `https` address leaves here, because the client hands it to the browser.
const asHttpsUrl = (value: unknown): string | null => {
  const text = cleanString(value)
  try {
    return text && new URL(text).protocol === 'https:' ? text : null
  } catch {
    return null
  }
}
// Timestamps are ISO 8601 strings.
const asMillis = (value: unknown): number | null => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(at) ? at : null
}

/** One issue from the list or the detail endpoint. Null when it has no id to address it by. */
export function normalizeIssue(connectionId: string, connectionLabel: string, raw: unknown): SentryIssueSummary | null {
  const issue = isRecord(raw) ? raw : {}
  const id = asString(issue.id)
  if (!id) return null
  return {
    connectionId,
    connectionLabel,
    id,
    shortId: asString(issue.shortId) ?? id,
    title: cleanString(issue.title) ?? '(untitled)',
    culprit: asString(issue.culprit),
    level: asString(issue.level) ?? 'error',
    status: asString(issue.status) ?? '',
    count: asCount(issue.count),
    userCount: asCount(issue.userCount),
    firstSeen: asMillis(issue.firstSeen),
    lastSeen: asMillis(issue.lastSeen),
    url: asHttpsUrl(issue.permalink),
  }
}

// Sentry gives a frame's source as `context`, a list of [line number, text] pairs. Keep a window
// around the line that ran.
function normalizeFrame(raw: unknown): SentryStackFrame {
  const frame = isRecord(raw) ? raw : {}
  const line = asNumber(frame.lineNo)
  const pairs = (Array.isArray(frame.context) ? frame.context : []).flatMap((pair) => {
    if (!Array.isArray(pair)) return []
    const number = asNumber(pair[0])
    const text = cleanString(pair[1])
    return number == null || text == null ? [] : [{ line: number, text }]
  })
  const center = Math.max(
    0,
    pairs.findIndex((pair) => pair.line === line),
  )
  const start = Math.max(0, center - Math.floor((CAPS.codeLinesPerFrame - 1) / 2))
  return {
    filename: asString(frame.filename) ?? asString(frame.absPath) ?? asString(frame.module) ?? '<unknown>',
    line,
    column: asNumber(frame.colNo),
    method: asString(frame.function),
    code: pairs.slice(start, start + CAPS.codeLinesPerFrame),
    inApp: typeof frame.inApp === 'boolean' ? frame.inApp : null,
  }
}

const entryData = (entries: unknown[], type: string): Record<string, unknown> | null => {
  const entry = entries.find((candidate) => isRecord(candidate) && candidate.type === type)
  return isRecord(entry) && isRecord(entry.data) ? entry.data : null
}

/** The latest event, reduced to its message and its stack. */
export function normalizeEvent(raw: unknown): SentryEvent {
  const event = isRecord(raw) ? raw : {}
  const entries = Array.isArray(event.entries) ? event.entries : []
  let truncated = false

  // Sentry lists a chain with the exception that was raised last. Read that one first.
  const chain = entryData(entries, 'exception')?.values
  const exceptions = (Array.isArray(chain) ? chain : []).slice().reverse()
  if (exceptions.length > CAPS.exceptions) truncated = true

  const frames: SentryStackFrame[] = []
  for (const exception of exceptions.slice(0, CAPS.exceptions)) {
    const stack = isRecord(exception) && isRecord(exception.stacktrace) ? exception.stacktrace : {}
    // Oldest call first on the wire, so reverse to put the call that threw at the top.
    const rawFrames = (Array.isArray(stack.frames) ? stack.frames : []).slice().reverse()
    for (const rawFrame of rawFrames) {
      if (frames.length >= CAPS.framesTotal) {
        truncated = true
        break
      }
      frames.push(normalizeFrame(rawFrame))
    }
  }

  const raised = isRecord(exceptions[0]) ? exceptions[0] : {}
  const messageEntry = entryData(entries, 'message')
  const tags = Array.isArray(event.tags) ? event.tags : []
  const environment = tags.find((tag) => isRecord(tag) && tag.key === 'environment')
  return {
    id: asString(event.eventID) ?? asString(event.id) ?? '',
    occurredAt: asMillis(event.dateCreated),
    exceptionType: asString(raised.type),
    message:
      asString(raised.value) ??
      asString(messageEntry?.formatted) ??
      asString(messageEntry?.message) ??
      asString(event.message) ??
      asString(event.title),
    frames,
    environment: isRecord(environment) ? asString(environment.value) : null,
    release: isRecord(event.release) ? asString(event.release.version) : asString(event.release),
    truncated,
  }
}

/** The issue and its latest event, halving the stack until the whole detail fits the cap. */
export function composeIssueDetail(issue: SentryIssueSummary, event: SentryEvent | null): SentryIssueDetail {
  let latest = event
  while (latest && latest.frames.length && Buffer.byteLength(JSON.stringify(latest), 'utf8') > CAPS.maxDetailBytes) {
    latest = { ...latest, frames: latest.frames.slice(0, Math.floor(latest.frames.length / 2)), truncated: true }
  }
  return { ...issue, latestEvent: latest }
}
