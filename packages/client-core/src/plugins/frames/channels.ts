// Channels a frame may subscribe to. A hand-written subset of ClientEventMap rather than its keys,
// because that map is a type with no runtime form — and because most of it should not be reachable
// anyway: `presentation:*` are the shell's own intents, while the `runtime:*` family says something a
// plugin may be showing has gone or moved.
export const SUBSCRIBABLE_CHANNELS = [
  'runtime:task-archived',
  'runtime:workspace-removed',
  'runtime:node-removed',
  'runtime:node-switched',
] as const

export type SubscribableChannel = (typeof SUBSCRIBABLE_CHANNELS)[number]

const CHANNEL_DESCRIPTIONS = {
  'runtime:task-archived': 'Receive task archive events',
  'runtime:workspace-removed': 'Receive workspace removal events',
  'runtime:node-removed': 'Receive node removal events',
  'runtime:node-switched': 'Receive active-node change events',
} as const satisfies Record<SubscribableChannel, string>

export const isSubscribable = (channel: string): channel is SubscribableChannel =>
  (SUBSCRIBABLE_CHANNELS as readonly string[]).includes(channel)

export const describeChannel = (channel: string): string | undefined =>
  isSubscribable(channel) ? CHANNEL_DESCRIPTIONS[channel] : undefined
