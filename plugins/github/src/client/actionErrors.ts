// What to tell a person when a GitHub write fails. A route that fails without GitHub's own prose
// answers with only its code, and the client used to print that code: "merge_failed", "reauth".
// The codes are the ones server/routes/pulls/prActions.ts and server/githubApi.ts return.

const SENTENCES: Record<string, string> = {
  merge_failed: "GitHub wouldn't merge this pull request. Check its reviews and checks.",
  reauth: "GitHub turned down acorn's sign-in. Reconnect GitHub.",
  auto_merge_not_allowed: "This repository doesn't allow auto-merge.",
  node_id_unknown: "acorn hasn't finished loading this pull request. Refresh it and try again.",
  head_sha_unknown: "acorn hasn't finished loading this pull request. Refresh it and try again.",
  rate_limited: 'GitHub is limiting requests. Try again in a minute.',
  forbidden: "Your GitHub account can't do that on this repository.",
  sso: "GitHub needs you to authorise this token for your organisation's single sign-on.",
  github_unavailable: "GitHub didn't answer. Try again.",
}

// A read is a different question from a write: nothing was refused, the list just isn't there. The
// codes are the ones server/routes/mirror/repoMirror.ts and server/githubApi.ts return for a list.
const NO_ACCESS = "GitHub won't show this repository to your account. If an organisation owns it, an owner may need to approve acorn's GitHub app under Third-party access."
const READ_SENTENCES: Record<string, string> = {
  repo_not_found: NO_ACCESS,
  forbidden: NO_ACCESS,
  sso: "Authorise acorn's GitHub sign-in for your organisation's single sign-on, then try again.",
  rate_limited: 'GitHub is limiting requests. Try again in a minute.',
  github_unavailable: "GitHub didn't answer.",
  reauth: "GitHub turned down acorn's sign-in.",
}

export type ActionFailure = { text: string; code?: string }

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message ?? cause)
const codeOf = (cause: unknown): string | undefined => {
  const code = (cause as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}
// Nothing a person can read: empty, the code itself, or the bare status the client falls back to.
const isBare = (text: string, code: string | undefined) => !text || text === code || /^\d{3}$/.test(text)

/** The failure as a sentence, and its code for anything that branches on it. GitHub's own prose is
 *  kept; only a message that is nothing but a code or a status number is replaced. */
export function actionFailure(cause: unknown): ActionFailure {
  const text = message(cause)
  const code = codeOf(cause)
  const sentence = isBare(text, code) ? (code && SENTENCES[code]) || "GitHub didn't accept that. Try again." : text
  return { text: sentence, ...(code ? { code } : {}) }
}

/** Why a GitHub read failed, as a sentence, or undefined when there is nothing better than the title. */
export function readFailure(cause: unknown): string | undefined {
  if (cause == null) return undefined
  const code = codeOf(cause)
  if (code && READ_SENTENCES[code]) return READ_SENTENCES[code]
  const text = message(cause)
  return isBare(text, code) ? undefined : text
}

/** A write wrapped so a failure with no prose says what failed, rather than the route's code. */
export const sayOnFailure = <T,>(work: Promise<T>, sentence: string): Promise<T> =>
  work.catch((cause: unknown) => {
    const text = message(cause)
    throw new Error(isBare(text, codeOf(cause)) ? sentence : text)
  })
