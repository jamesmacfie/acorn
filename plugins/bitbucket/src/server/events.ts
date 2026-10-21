import type { PluginBroadcast } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

// What bitbucket announces on its own channel (docs/plugins/events.md § Hearing another plugin). Every
// verb means "re-read the mirror".
type BitbucketVerb = 'pr-synced' | 'checks-changed' | 'pulls-changed' | 'repos-changed'
export type BitbucketEmit = (verb: BitbucketVerb, payload?: Record<string, unknown>) => void

// The two pull request verbs also say the `pull-requests` source changed, so every route that
// announces a mirror write does both (docs/data-sources/changes.md).
export const bitbucketEmitter =
  (send: PluginBroadcast['send'], changed: (sourceId: string) => void): BitbucketEmit =>
  (verb, payload = {}) => {
    send({ channel: pluginChannel('bitbucket', verb), ...payload })
    if (verb === 'pulls-changed' || verb === 'pr-synced') changed('pull-requests')
  }

/** A pull request's identity on the channel: its repository's full name and its number. */
export const pullRequestPayload = (repository: string, number: number) => ({ repository, number })

/** For tests and any caller with nobody listening. */
export const NO_EMIT: BitbucketEmit = () => {}
