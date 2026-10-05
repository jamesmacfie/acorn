import type { SourceFailure } from '@acorn/dashboards-core/plan.ts'
import { ApiError } from '../../infra/node/apiClient'

// The one place a data source failure becomes words (docs/dashboards.md § Published panels). The
// studio, the placed panel, and the source picker all read it, so a missing account says the same
// thing everywhere, names the source or the input at fault, and never shows a code or a pointer.

/** A fix the host draws beside the message. Loaded plugins can't open Settings, so each one is host UI. */
export type SourceFix = 'choose-account' | 'review' | 'reconnect' | 'turn-on' | 'retry'

/** The names a sentence uses, looked up by the caller. Anything missing falls back to plainer words. */
export type SourceFailureNames = {
  source: string
  plugin?: string
  /** True when the source's plugin is turned off on its Node. */
  pluginOff?: boolean
  provider?: string
  input?: { label: string; provider?: string; plural?: string; account?: string }
}

export type SourceFailureText = { message: string; fix?: SourceFix }

const article = (word: string) => /^[aeiou]/i.test(word) ? 'an' : 'a'
/** Words a person can read: not empty, not the code itself, not a bare HTTP status, and not another
 *  code such as `github_unavailable`. The same rule as the GitHub plugin's `readFailure`
 *  (plugins/github/src/client/actionErrors.ts), which core can't import. */
const readable = (detail: string | undefined, code: string): string | undefined => {
  const text = detail?.trim()
  if (!text || text === code || /^\d{3}$/.test(text) || /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(text)) return undefined
  return /[.!?]$/.test(text) ? text : `${text}.`
}
const needsAccount = (who: string, provider: string | undefined) => provider ? `${who} needs ${article(provider)} ${provider} account.` : `${who} needs an account.`

/** The sentence and fix for one failure. */
export function describeSourceFailure(failure: SourceFailure, names: SourceFailureNames): SourceFailureText {
  const input = names.input ?? (failure.input ? { label: failure.input } : undefined)
  switch (failure.code) {
    case 'connection-required': return { message: needsAccount(names.source, names.provider), fix: 'choose-account' }
    case 'input-required': return { message: needsAccount(input?.label ?? names.source, input?.provider), fix: 'choose-account' }
    case 'input-unavailable':
      if (failure.reason === 'Not approved') return { message: `${names.plugin ?? names.source} is waiting for you to approve what it reads.`, fix: 'review' }
      if (failure.reason === 'Source not installed') return { message: `${input?.label ?? names.source} can't be read, because its source isn't installed.` }
      return {
        message: `${input?.label ?? names.source} can't be read. ${input?.account ? `The ${input.account} account` : 'Its account'} is disconnected.`,
        fix: 'reconnect',
      }
    case 'unavailable':
      if (names.pluginOff && names.plugin) return { message: `${names.source} comes from ${names.plugin}, which is off.`, fix: 'turn-on' }
      break
    case 'forbidden': return { message: "This account isn't available in this workspace.", fix: 'choose-account' }
    case 'rate-limited': return { message: `${names.provider ?? names.source} asked us to slow down. Trying again shortly.` }
    case 'timeout': return { message: `${names.source} took longer than the panel allows.` }
    case 'incomplete': {
      if (failure.reason === 'invalid-records') {
        const count = failure.count ?? 1
        return { message: `${names.source} returned ${count} ${count === 1 ? "record that didn't" : "records that didn't"} match what it declared.` }
      }
      if (input) return { message: `${input.provider ?? input.label} returned only part of the ${(input.plural ?? 'records').toLowerCase()}, so some items may be missing.` }
      return { message: `${names.source} returned only part of its records, so some items may be missing.` }
    }
  }
  // No sentence for this code, so the source's own `reason` says why, when it gave one
  // (docs/data-sources.md § Register a source).
  const detail = readable(failure.reason, failure.code)
  return { message: detail ? `${names.source} couldn't answer. ${detail}` : `${names.source} couldn't answer.`, fix: 'retry' }
}

/** A failure from a data source route's error, for the source picker. Undefined for any other error. */
export function failureFromError(error: unknown): SourceFailure | undefined {
  if (!(error instanceof ApiError) || !error.code) return undefined
  const details = error.details && typeof error.details === 'object' ? error.details as { input?: unknown; reason?: unknown } : {}
  return {
    code: error.code,
    ...(typeof details.input === 'string' ? { input: details.input } : {}),
    ...(typeof details.reason === 'string' ? { reason: details.reason } : {}),
  }
}
