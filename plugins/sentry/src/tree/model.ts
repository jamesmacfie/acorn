import type { SentryEvent } from '../shared/api'

export function relativeTime(at: number | null, now = Date.now()): string {
  if (!at) return 'Not reported'
  const seconds = Math.max(0, Math.round((now - at) / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}

/** "TypeError: Cannot read…", the type and the message together. */
export const eventTitle = (event: SentryEvent): string =>
  [event.exceptionType, event.message].filter(Boolean).join(': ') || 'No message'

/** The stack as one block of text: a location line per frame, with its source lines indented under
 *  it. "›" marks the line that ran. */
export const traceText = (frames: SentryEvent['frames']): string =>
  frames
    .map((frame) =>
      [
        `${frame.filename}${frame.line == null ? '' : `:${frame.line}`}${frame.method ? ` · ${frame.method}` : ''}`,
        ...frame.code.map(
          (line) => `  ${line.line === frame.line ? '›' : ' '} ${String(line.line).padStart(4)}  ${line.text}`,
        ),
      ].join('\n'),
    )
    .join('\n')

// Level and status as a word and a tone from a map (docs/ui-design/states.md § States). An unknown
// value keeps its own word, capitalised, and stays neutral.
type Tone = 'neutral' | 'ok' | 'warn' | 'danger'
const LEVELS: Record<string, [string, Tone]> = {
  fatal: ['Fatal', 'danger'],
  error: ['Error', 'danger'],
  warning: ['Warning', 'warn'],
  info: ['Info', 'neutral'],
  debug: ['Debug', 'neutral'],
}
const STATUSES: Record<string, [string, Tone]> = {
  unresolved: ['Unresolved', 'neutral'],
  resolved: ['Resolved', 'ok'],
  ignored: ['Ignored', 'neutral'],
}
const word = (table: Record<string, [string, Tone]>, value: string): { label: string; tone: Tone } => {
  const [label, tone] = table[value.toLowerCase()] ?? [value.charAt(0).toUpperCase() + value.slice(1), 'neutral']
  return { label, tone }
}
export const levelWord = (level: string) => word(LEVELS, level)
export const statusWord = (status: string) => word(STATUSES, status)

// For a failure whose route sent no sentence of its own.
const REASONS: Record<string, string> = {
  provider_needs_auth: "Sentry turned down acorn's token.",
  provider_rate_limited: 'Sentry is limiting requests. Try again in a minute.',
  provider_unavailable: "Sentry didn't answer. Try again.",
  provider_not_connected: "Sentry isn't connected.",
  provider_resource_not_found: "Sentry can't find this issue.",
}

/** A failed bridge call as one plain sentence. A message that is more than its own code is kept. */
export function failureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  const message = error instanceof Error ? error.message : ''
  if (message && message !== code && !/^[a-z_]+$/.test(message)) return message
  return (typeof code === 'string' && REASONS[code]) || 'Something went wrong. Try again.'
}
