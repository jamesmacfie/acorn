import type { PluginBroadcast } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/pluginState.ts'

// What github announces on its own channel (docs/future/events/plugin-events.md § github). Three
// verbs, all "re-read this": the payload names what to re-read and nothing else.
export type GithubVerb = 'pr-synced' | 'checks-changed' | 'pulls-changed'
export type GithubEmit = (verb: GithubVerb, payload: Record<string, unknown>) => void

export const githubEmitter = (send: PluginBroadcast['send']): GithubEmit =>
  (verb, payload) => send({ channel: pluginChannel('github', verb), ...payload })

/** For the routes' tests and any caller with nobody listening. */
export const NO_EMIT: GithubEmit = () => {}
