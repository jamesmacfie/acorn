import { createSignal } from 'solid-js'
import type { ChangeRequestHost } from '@acorn/change-request-ui/views'

// GitLab as the shared review views name it (docs/plugins/change-request-ui.md). GitLab's routes
// answer the neutral model directly, so all that's left here is the words, the pictures, and the
// sentences for a refused write.

// Every picture GitLab has sent, by username. A list row and a detail fill it as they arrive, and a
// signal, so an avatar drawn before its picture arrives picks it up.
const [avatars, setAvatars] = createSignal<Record<string, string>>({})

export function rememberAvatars(found: Record<string, string | null | undefined>): void {
  const known = avatars()
  const fresh = Object.entries(found).filter(
    (entry): entry is [string, string] => !!entry[1] && known[entry[0]] !== entry[1],
  )
  if (fresh.length) setAvatars({ ...known, ...Object.fromEntries(fresh) })
}

const SENTENCES: Record<string, string> = {
  reauth: "GitLab turned down acorn's sign-in. Reconnect GitLab.",
  merge_failed: "GitLab wouldn't merge this merge request. Check its approvals, pipeline, and conflicts.",
  forbidden: "Your GitLab account can't do that in this project.",
  rate_limited: 'GitLab is limiting requests. Try again in a minute.',
  head_sha_unknown: "acorn hasn't finished loading this merge request. Refresh it and try again.",
  gitlab_unavailable: "GitLab didn't answer. Try again.",
}

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String((cause as { message?: unknown })?.message ?? cause)
const codeOf = (cause: unknown): string | undefined => {
  const code = (cause as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** GitLab's own prose is kept; a message that is only a code or a status number becomes a sentence. */
export function describeFailure(cause: unknown): { text: string; code?: string } {
  const text = message(cause)
  const code = codeOf(cause)
  const bare = !text || text === code || /^\d{3}$/.test(text)
  return {
    text: bare ? (code && SENTENCES[code]) || "GitLab didn't accept that. Try again." : text,
    ...(code ? { code } : {}),
  }
}

export const gitlabHost: ChangeRequestHost = {
  pluginId: 'gitlab',
  label: 'GitLab',
  noun: 'merge request',
  prefix: '!',
  avatar: (login) => (login ? avatars()[login] : undefined),
  describeFailure,
}

export const GITLAB_MERGE_METHODS = [
  { value: 'merge', label: 'Merge', word: 'merge commit' },
  { value: 'squash', label: 'Squash and merge', word: 'squash' },
]
