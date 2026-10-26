// The wire shapes this plugin's routes answer with. They live here, not in `@acorn/protocol`, because a
// plugin owns its own wire surface (docs/architecture/node-api.md). Every field passed through the
// allowlist in server/normalize.ts, so raw Sentry JSON never crosses this boundary.

export type SentryIssueSummary = {
  /** A Settings connection's id, or `env` for the environment's credential. */
  connectionId: string
  connectionLabel: string
  id: string
  shortId: string
  title: string
  culprit: string | null
  level: string
  status: string
  count: number
  userCount: number
  firstSeen: number | null
  lastSeen: number | null
}

export type SentryStackFrame = {
  filename: string
  line: number | null
  column: number | null
  method: string | null
  code: Array<{ line: number; text: string }>
  inApp: boolean | null
}

export type SentryEvent = {
  id: string
  occurredAt: number | null
  exceptionType: string | null
  message: string | null
  /** Newest call first, as Sentry draws a stack, across every exception in the chain. */
  frames: SentryStackFrame[]
  environment: string | null
  release: string | null
  /** A cap fired, so something Sentry sent was left out. */
  truncated: boolean
}

export type SentryIssueDetail = SentryIssueSummary & { latestEvent: SentryEvent | null }

export const sentryIssueRoute = (connectionId: string, issueId: string) =>
  `/v1/p/sentry/issues/${encodeURIComponent(issueId)}?connection=${encodeURIComponent(connectionId)}`
