// Channels a frame may subscribe to. A hand-written subset of ClientEventMap rather than its keys,
// because that map is a type with no runtime form — and because most of it should not be reachable
// anyway: `presentation:*` are the shell's own intents, while the `runtime:*` family says something a
// plugin may be showing has gone or moved.
// A type-only import, so it is erased and creates no runtime edge back to the module that consumes
// these descriptions.
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

export const isSubscribable = (channel: string): channel is SubscribableChannel =>
  (SUBSCRIBABLE_CHANNELS as readonly string[]).includes(channel)

export const describeChannel = (channel: string): GrantDescription | undefined =>
  isSubscribable(channel) ? CHANNEL_DESCRIPTIONS[channel] : undefined
