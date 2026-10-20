import type { PluginBroadcast } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

// What github announces on its own channel (docs/plugins/events.md § Hearing another plugin). All four
// verbs mean "re-read current mirror state"; the two repository source events need no content.
type GithubVerb = 'pr-synced' | 'checks-changed' | 'pulls-changed' | 'repos-changed'
export type GithubEmit = (verb: GithubVerb, payload?: Record<string, unknown>) => void

// The two pull request verbs also say the `pull-requests` source changed, so every route that
// announces a mirror write does both (docs/data-sources/changes.md).
export const githubEmitter =
  (send: PluginBroadcast['send'], changed: (sourceId: string) => void): GithubEmit =>
  (verb, payload = {}) => {
    send({ channel: pluginChannel('github', verb), ...payload })
    if (verb === 'pulls-changed' || verb === 'pr-synced') changed('pull-requests')
  }

export const prChangedPayload = (scope: { owner: string; repo: string; number: number; headSha: string | null }) => ({
  repoOwner: scope.owner,
  repoName: scope.repo,
  pullNumber: scope.number,
  headSha: scope.headSha,
})

/** For the routes' tests and any caller with nobody listening. */
export const NO_EMIT: GithubEmit = () => {}
