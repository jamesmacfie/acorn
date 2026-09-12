import type { PluginBroadcast } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

// What github announces on its own channel (docs/plugins.md § Hearing another plugin). All four
// verbs mean "re-read current mirror state"; the two repository collection events need no content.
export type GithubVerb = 'pr-synced' | 'checks-changed' | 'pulls-changed' | 'repos-changed'
export type GithubEmit = (verb: GithubVerb, payload?: Record<string, unknown>) => void

export const githubEmitter = (send: PluginBroadcast['send']): GithubEmit =>
  (verb, payload = {}) => send({ channel: pluginChannel('github', verb), ...payload })

export const prChangedPayload = (scope: {
  owner: string
  repo: string
  number: number
  headSha: string | null
}) => ({
  repoOwner: scope.owner,
  repoName: scope.repo,
  pullNumber: scope.number,
  headSha: scope.headSha,
})

/** For the routes' tests and any caller with nobody listening. */
export const NO_EMIT: GithubEmit = () => {}
