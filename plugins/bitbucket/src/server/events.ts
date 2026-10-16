import type { PluginBroadcast } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

// What bitbucket announces on its own channel (docs/plugins/events.md § Hearing another plugin). Every
// verb means "re-read the mirror". workflows hears `checks-changed`.
type BitbucketVerb = 'pr-synced' | 'checks-changed' | 'pulls-changed' | 'repos-changed'
export type BitbucketEmit = (verb: BitbucketVerb, payload?: Record<string, unknown>) => void

export const bitbucketEmitter =
  (send: PluginBroadcast['send']): BitbucketEmit =>
  (verb, payload = {}) =>
    send({ channel: pluginChannel('bitbucket', verb), ...payload })

/** A pull request's identity on the channel: its repository's full name and its number. */
export const pullRequestPayload = (repository: string, number: number) => ({ repository, number })

/** For tests and any caller with nobody listening. */
export const NO_EMIT: BitbucketEmit = () => {}
