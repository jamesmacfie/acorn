// Channels a frame may subscribe to. A hand-written subset of ClientEventMap rather than its keys,
// because that map is a type with no runtime form, and because most of it should not be reachable
// anyway: `presentation:*` are the shell's own intents.
//
// Two families live here, and the split is the point (settled 2026-08-28, before the first addition
// made it unsettleable — docs/future/events/delivery.md § The naming problem):
//
//   `runtime:*`        the shell talking to itself. "Something you were displaying is gone or moved."
//                      A deletion and invalidation list, emitted in the renderer that caused it, so a
//                      plugin in another window never sees it. That is correct for what these mean:
//                      they are about this window's own state, not about the node's.
//   `<noun>:changed`   a node-emitted fact. "Something happened on this node that you may want to act
//                      on." Emitted where the write happens and delivered over the socket, so every
//                      window hears it. The same names are in NODE_EVENT_CHANNELS
//                      (@acorn/protocol/nodeEvents.ts), because one grant list covers a frame
//                      subscribing and a plugin's node half listening.
//
// Reading them as one list is what would go wrong: an author who saw `tasks:changed` beside
// `runtime:task-archived` and concluded both were renderer-local would build on the wrong contract.
//
// A type-only import, so it is erased and creates no runtime edge back to the module that consumes
// these descriptions.
import { isNodeEventChannel } from '@acorn/protocol/nodeEvents.ts'
import { parsePluginChannel } from '@acorn/protocol/pluginState.ts'
import type { GrantDescription } from '../permissions'

export const SUBSCRIBABLE_CHANNELS = [
  'runtime:task-archived',
  'runtime:workspace-removed',
  'runtime:node-removed',
  'runtime:node-switched',
  'tasks:changed',
] as const

export type SubscribableChannel = (typeof SUBSCRIBABLE_CHANNELS)[number]

// The copy, plus how the trust prompt draws it. Severity travels with the grant from here rather than
// being reconstructed from the sentence downstream (plugins/permissions.ts).
const CHANNEL_DESCRIPTIONS = {
  'runtime:task-archived': { text: 'Receive task archive events', icon: 'radio' },
  'runtime:workspace-removed': { text: 'Receive workspace removal events', icon: 'radio' },
  'runtime:node-removed': { text: 'Receive node removal events', icon: 'radio' },
  'runtime:node-switched': { text: 'Receive active-node change events', icon: 'radio' },
  'tasks:changed': { text: 'Receive notice when this node’s tasks change', icon: 'radio' },
} as const satisfies Record<SubscribableChannel, GrantDescription>

/** One of the shell's own channels. Stays a narrow predicate, because its callers go on to index
 *  `ClientEventMap` with what it accepted. */
export const isSubscribable = (channel: string): channel is SubscribableChannel =>
  (SUBSCRIBABLE_CHANNELS as readonly string[]).includes(channel)

// The node side of the same grant list. `permissions.events` is one vocabulary across both sides of
// the wire (node-core/server/plugin/context.ts § on), so a manifest naming one of these is asking for
// its node half to hear a core event, not for its frame to subscribe to anything.
//
// `tasks:changed` is in both lists, which is what a node-emitted fact looks like: the same name, the
// same sentence, one grant, and either half of the plugin may take it up. `plugins:changed` is not in
// the frame list because a frame has no roster to reconcile — that is the shell's job, and it does it
// whether or not a plugin asked.
const NODE_EVENT_DESCRIPTIONS: Readonly<Record<string, GrantDescription>> = {
  'plugins:changed': { text: 'Receive notice when this node’s plugin set changes', icon: 'radio' },
}

export const describeChannel = (channel: string): GrantDescription | undefined => {
  if (isSubscribable(channel)) return CHANNEL_DESCRIPTIONS[channel]
  if (isNodeEventChannel(channel)) return NODE_EVENT_DESCRIPTIONS[channel]
  // One host-owned sentence rather than one per verb. The verb is manifest text, and every sentence the
  // trust prompt draws under "Enforced" has to be copy the host owns (plugins/permissions.ts says why),
  // so it does not get interpolated in however well-formed it parsed.
  return parsePluginChannel(channel)
    ? { text: 'Receive live updates from its own node half', icon: 'radio' }
    : undefined
}
