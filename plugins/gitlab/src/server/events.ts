import type { PluginBroadcast } from '@acorn/plugin-api/node'
import { pluginChannel } from '@acorn/protocol/plugin/state.ts'

// What gitlab announces on its own channel (docs/plugins/events.md § Hearing another plugin). Every
// verb means "re-read the mirror". workflows hears `checks-changed`.
type GitlabVerb = 'pr-synced' | 'checks-changed' | 'pulls-changed' | 'repos-changed'
export type GitlabEmit = (verb: GitlabVerb, payload?: Record<string, unknown>) => void

export const gitlabEmitter =
  (send: PluginBroadcast['send']): GitlabEmit =>
  (verb, payload = {}) =>
    send({ channel: pluginChannel('gitlab', verb), ...payload })

/** A merge request's identity on the channel: its project's path in GitLab's spelling and its number. */
export const mergeRequestPayload = (path: string, iid: number) => ({ projectPath: path, number: iid })

/** For tests and any caller with nobody listening. */
export const NO_EMIT: GitlabEmit = () => {}
