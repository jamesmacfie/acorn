// Rollbar occurrence normalization (docs/security.md). Rollbar occurrence payloads are variable and
// can carry secrets and personal data even when an SDK scrubbed common keys. Acorn applies its OWN
// allowlist here before anything is persisted or rendered: only the fields below survive, every
// string is control-char-stripped and length-capped, and the whole detail is size-bounded so it
// stays well below the 256 KB generic cache ceiling. Raw request bodies, headers, cookies, query
// values, locals, arbitrary `custom`/`extra`, telemetry, and raw crash reports are dropped.
//
// Pure and network-free: unit-tested against synthetic fixtures (no real occurrence value, no token).

import type {
  RollbarItemDetail,
  RollbarItemSummary,
  RollbarOccurrenceDetail,
  RollbarStackFrame,
} from '../../../core/shared/api'
import { levelName, type RollbarApiInstance, type RollbarApiItem } from './'
import { isRecord } from '../../../core/server/integrations/codec'

// Suggested caps (docs/next/rollbar.md). Exported so tests assert against the same numbers.
export const CAPS = {
  traceChains: 10,
  framesTotal: 200,
  codeLinesPerFrame: 7,
  maxStringBytes: 8 * 1024,
  maxDetailBytes: 192 * 1024,
} as const

// eslint-disable-next-line no-control-regex -- deliberately matching C0 controls to strip them.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

// Render-as-text hygiene: drop control chars (keep \n and \t), then byte-cap. Returns null for empties
// so optional fields stay null rather than "".
function cleanString(value: unknown, max = CAPS.maxStringBytes): string | null {
  if (typeof value !== 'string') return null
  let s = value.replace(CONTROL, '')
  if (!s) return null
  if (Buffer.byteLength(s, 'utf8') > max) s = `${Buffer.from(s, 'utf8').subarray(0, max).toString('utf8')}…`
  return s
}

const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
// Rollbar timestamps are unix seconds; occurrence/item mix seconds and (rarely) ms. Treat >1e12 as ms.
const asMillis = (value: unknown): number | null => {
  const n = asNumber(value)
  if (n == null || n <= 0) return null
  return n > 1e12 ? Math.round(n) : Math.round(n * 1000)
}
const asString = (value: unknown): string | null => (value == null ? null : cleanString(String(value)))

// One frame → { filename, line, column, method, code, inProject }. Rollbar supplies the offending
// line as `code` and surrounding lines under `context.pre` / `context.post`; we keep a small window.
function normalizeFrame(raw: unknown): RollbarStackFrame {
  const f = isRecord(raw) ? raw : {}
  const line = asNumber(f.lineno)
  const ctx = isRecord(f.context) ? f.context : {}
  const pre = Array.isArray(ctx.pre) ? ctx.pre : []
  const post = Array.isArray(ctx.post) ? ctx.post : []
  const code: RollbarStackFrame['code'] = []
  const budget = CAPS.codeLinesPerFrame
  // Anchor around the offending line number when we have one; otherwise index from 1.
  const anchor = line ?? pre.length + 1
  const preKeep = Math.min(pre.length, Math.floor((budget - 1) / 2))
  pre.slice(pre.length - preKeep).forEach((text, i) => {
    const t = cleanString(text)
    if (t != null) code.push({ line: anchor - (preKeep - i), text: t })
  })
  const mainLine = cleanString(f.code)
  if (mainLine != null && code.length < budget) code.push({ line: anchor, text: mainLine })
  for (let i = 0; i < post.length && code.length < budget; i++) {
    const t = cleanString(post[i])
    if (t != null) code.push({ line: anchor + i + 1, text: t })
  }
  return {
    filename: asString(f.filename) ?? '<unknown>',
    line,
    column: asNumber(f.colno),
    method: asString(f.method),
    code,
    inProject: typeof f.in_app === 'boolean' ? f.in_app : null,
  }
}

type Exception = { class: string | null; message: string | null }
const readException = (raw: unknown): Exception => {
  const e = isRecord(raw) && isRecord(raw.exception) ? raw.exception : {}
  return { class: asString(e.class), message: asString(e.message) }
}

// Normalize one occurrence body into the allowlisted detail. `truncated` is set when any cap fired,
// so the UI can say "omitted by Acorn" rather than implying upstream absence.
export function normalizeOccurrence(instance: RollbarApiInstance): RollbarOccurrenceDetail {
  const occurrence = isRecord(instance.occurrence) ? instance.occurrence : {}
  const body = isRecord(occurrence.body) ? occurrence.body : {}
  let truncated = false

  // Determine the trace(s) to read.
  const chain = Array.isArray(body.trace_chain) ? body.trace_chain : null
  const trace = isRecord(body.trace) ? body.trace : null
  const message = isRecord(body.message) ? body.message : null
  const crash = isRecord(body.crash_report) ? body.crash_report : null

  let kind: RollbarOccurrenceDetail['kind'] = 'unknown'
  const traces: unknown[] = []
  if (chain && chain.length) {
    kind = 'trace-chain'
    if (chain.length > CAPS.traceChains) truncated = true
    traces.push(...chain.slice(0, CAPS.traceChains))
  } else if (trace) {
    kind = 'trace'
    traces.push(trace)
  } else if (message) {
    kind = 'message'
  } else if (crash) {
    kind = 'crash-report'
  }

  const frames: RollbarStackFrame[] = []
  let exception: Exception = { class: null, message: null }
  for (const t of traces) {
    if (!exception.class && !exception.message) exception = readException(t)
    const rawFrames = isRecord(t) && Array.isArray(t.frames) ? t.frames : []
    for (const rf of rawFrames) {
      if (frames.length >= CAPS.framesTotal) {
        truncated = true
        break
      }
      frames.push(normalizeFrame(rf))
    }
  }

  const messageBody = kind === 'message' ? cleanString((message as Record<string, unknown>).body) : null
  const request = isRecord(occurrence.request) ? occurrence.request : null
  const server = isRecord(occurrence.server) ? occurrence.server : null
  const person = isRecord(occurrence.person) ? occurrence.person : null
  const notifier = isRecord(occurrence.notifier) ? occurrence.notifier : null

  return {
    id: asString(instance.id) ?? '',
    occurredAt: asMillis(instance.timestamp) ?? asMillis(occurrence.timestamp),
    uuid: asString(occurrence.uuid),
    kind,
    exceptionClass: exception.class,
    message: exception.message ?? messageBody,
    frames,
    request: request ? { method: asString(request.method), url: asString(request.url) } : null,
    context: asString(occurrence.context),
    codeVersion: asString(occurrence.code_version),
    platform: asString(occurrence.platform),
    language: asString(occurrence.language),
    framework: asString(occurrence.framework),
    server: server ? { host: asString(server.host), branch: asString(server.branch) } : null,
    person: person
      ? { id: asString(person.id), username: asString(person.username), email: asString(person.email) }
      : null,
    notifier: notifier ? { name: asString(notifier.name), version: asString(notifier.version) } : null,
    truncated,
  }
}

// Build the item summary row from a list/canonical item response.
export function normalizeSummary(integrationId: string, integrationLabel: string, raw: RollbarApiItem): RollbarItemSummary {
  return {
    integrationId,
    integrationLabel,
    identifier: String(raw.counter),
    itemId: String(raw.id),
    title: cleanString(raw.title) ?? '(untitled)',
    level: levelName(raw.level),
    environment: asString(raw.environment) ?? '',
    status: asString(raw.status) ?? '',
    totalOccurrences: asNumber(raw.total_occurrences) ?? 0,
    firstOccurrenceAt: asMillis(raw.first_occurrence_timestamp),
    lastOccurrenceAt: asMillis(raw.last_occurrence_timestamp),
    ...(cleanString(raw.framework) ? { framework: cleanString(raw.framework)! } : {}),
  }
}

// Assemble the full detail. If the normalized detail somehow still exceeds the byte target (huge
// frames), drop the most sensitive field first (email), then progressively trim frames.
export function normalizeItemDetail(
  summary: RollbarItemSummary,
  item: RollbarApiItem,
  occurrence: RollbarOccurrenceDetail | null,
): RollbarItemDetail {
  let latest = occurrence
  if (latest) {
    let guard = 0
    // Email is diagnostic but the most sensitive field — drop it first under pressure.
    while (Buffer.byteLength(JSON.stringify(latest), 'utf8') > CAPS.maxDetailBytes && guard++ < 64) {
      if (latest.person?.email) {
        latest = { ...latest, person: { ...latest.person, email: null }, truncated: true }
        continue
      }
      if (latest.frames.length) {
        latest = { ...latest, frames: latest.frames.slice(0, Math.floor(latest.frames.length / 2)), truncated: true }
        continue
      }
      latest = { ...latest, context: null, message: latest.message?.slice(0, 512) ?? null, truncated: true }
      break
    }
  }
  return {
    ...summary,
    resolvedInVersion: asString(item.resolved_in_version),
    assignedTo: asString(item.assigned_user_id),
    url: null, // no reliable web URL from the documented read endpoints — omit rather than guess.
    latestOccurrence: latest,
  }
}
