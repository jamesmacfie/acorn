// Channels a frame may subscribe to. A hand-written subset of ClientEventMap rather than its keys,
// because that map is a type with no runtime form, and because most of it should not be reachable
// anyway: `presentation:*` are the shell's own intents, while the `runtime:*` family says something a
// plugin may be showing has gone or moved.
// A type-only import, so it is erased and creates no runtime edge back to the module that consumes
// these descriptions.
import { parsePluginChannel } from '@acorn/protocol/pluginState.ts'
import type { GrantDescription } from '../permissions'

export const SUBSCRIBABLE_CHANNELS = [
  'runtime:task-archived',
  'runtime:workspace-removed',
  'runtime:node-removed',
  'runtime:node-switched',
] as const

export type SubscribableChannel = (typeof SUBSCRIBABLE_CHANNELS)[number]

// The copy, plus how the trust prompt draws it. Severity travels with the grant from here rather than
// being reconstructed from the sentence downstream (plugins/permissions.ts).
const CHANNEL_DESCRIPTIONS = {
  'runtime:task-archived': { text: 'Receive task archive events', icon: 'radio' },
  'runtime:workspace-removed': { text: 'Receive workspace removal events', icon: 'radio' },
  'runtime:node-removed': { text: 'Receive node removal events', icon: 'radio' },
  'runtime:node-switched': { text: 'Receive active-node change events', icon: 'radio' },
} as const satisfies Record<SubscribableChannel, GrantDescription>

/** One of the shell's own channels. Stays a narrow predicate, because its callers go on to index
 *  `ClientEventMap` with what it accepted. */
export const isSubscribable = (channel: string): channel is SubscribableChannel =>
  (SUBSCRIBABLE_CHANNELS as readonly string[]).includes(channel)

// Anything a frame may name at all, which is the shell's list plus the plugin's own live channel. That
// second half is admitted by shape rather than by name, because core cannot enumerate verbs it never
// sees: `plugin:<id>:<verb>` is declared by the manifest and served by that plugin's own node half
// (plugins/pluginChannel.ts). Whether *this* frame owns the id is a different question, and
// frameServices.ts is where it gets asked — the same split the api verb makes between "is this shaped
// like a plugin route" and "is it yours".
export const isFrameChannel = (channel: string): boolean =>
  isSubscribable(channel) || parsePluginChannel(channel) !== null

export const describeChannel = (channel: string): GrantDescription | undefined => {
  if (isSubscribable(channel)) return CHANNEL_DESCRIPTIONS[channel]
  // One host-owned sentence rather than one per verb. The verb is manifest text, and every sentence the
  // trust prompt draws under "Enforced" has to be copy the host owns (plugins/permissions.ts says why),
  // so it does not get interpolated in however well-formed it parsed.
  return parsePluginChannel(channel)
    ? { text: 'Receive live updates from its own node half', icon: 'radio' }
    : undefined
}
