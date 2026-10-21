import type { PluginBroadcast } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

// What github announces on its own channel (docs/plugins/events.md § Hearing another plugin). All four
// verbs mean "re-read current mirror state"; the two repository source events need no content.
type GithubVerb = 'pr-synced' | 'checks-changed' | 'pulls-changed' | 'repos-changed'
export type GithubEmit = (
  verb: GithubVerb,
  payload?: Record<string, unknown>,
  options?: { unchanged?: boolean },
) => void

// The two pull request verbs also say the `pull-requests` source changed, so every route that
// announces a mirror write does both (docs/data-sources/changes.md). A refresh that wrote the mirror
// but found every row as it was passes `unchanged`, because a changed source wakes the record triggers
// that read it.
export const githubEmitter =
  (send: PluginBroadcast['send'], changed: (sourceId: string) => void): GithubEmit =>
  (verb, payload = {}, { unchanged = false } = {}) => {
    send({ channel: pluginChannel('github', verb), ...payload })
    if (!unchanged && (verb === 'pulls-changed' || verb === 'pr-synced')) changed('pull-requests')
  }

export const prChangedPayload = (scope: { owner: string; repo: string; number: number; headSha: string | null }) => ({
  repoOwner: scope.owner,
  repoName: scope.repo,
  pullNumber: scope.number,
  headSha: scope.headSha,
})

/** For the routes' tests and any caller with nobody listening. */
export const NO_EMIT: GithubEmit = () => {}
