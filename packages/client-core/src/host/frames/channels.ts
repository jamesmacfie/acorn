// Channels a frame may subscribe to. A hand-written subset of ClientEventMap rather than its keys,
// because that map is a type with no runtime form, and because most of it should not be reachable
// anyway: `presentation:*` are the shell's own intents.
//
// Two families live here, and the split is the point (settled 2026-08-28, before the first addition
// made it unsettleable — docs/plugins.md § Hearing a core event):
//
//   `runtime:*`        the shell talking to itself, about this window. Mostly "something you were
//                      displaying is gone or moved" — a deletion and invalidation list — plus
//                      `focus-changed`, which is the other thing only this window can know. All of
//                      them are emitted in the renderer that caused them, so a plugin in another
//                      window never sees one. That is correct for what these mean: they are about
//                      this window's own state, not about the node's.
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
import { parsePluginChannel } from '@acorn/protocol/plugin/state.ts'
import type { GrantDescription } from '../trust/permissions'

export const SUBSCRIBABLE_CHANNELS = [
  'runtime:task-archived',
  'runtime:workspace-removed',
  'runtime:node-removed',
  'runtime:node-switched',
  'runtime:focus-changed',
  'tasks:changed',
  'workspace:changed',
  'workspace-projects:changed',
  'connection:changed',
  'head:changed',
  'run:changed',
  'agent-session:changed',
  'project:changed',
] as const

export type SubscribableChannel = (typeof SUBSCRIBABLE_CHANNELS)[number]

// The copy, plus how the trust prompt draws it. Severity travels with the grant from here rather than
// being reconstructed from the sentence downstream (plugins/permissions.ts).
const CHANNEL_DESCRIPTIONS = {
  'runtime:task-archived': { text: 'Receive task archive events', icon: 'radio' },
  'runtime:workspace-removed': { text: 'Receive workspace removal events', icon: 'radio' },
  'runtime:node-removed': { text: 'Receive node removal events', icon: 'radio' },
  'runtime:node-switched': { text: 'Receive active-node change events', icon: 'radio' },
  'runtime:focus-changed': { text: 'See which pane and region of this window has keyboard focus', icon: 'radio' },
  'tasks:changed': { text: 'Receive notice when this node’s tasks change', icon: 'radio' },
  'workspace:changed': { text: 'Receive notice when this node’s workspaces change', icon: 'radio' },
  'workspace-projects:changed': { text: 'See when external projects mapped to this node’s workspaces change', icon: 'radio' },
  // Named for what the owner is consenting to rather than for the frame: the payload carries a provider
  // id and a status, so a plugin granted this learns which of their accounts stopped working and when
  // one is reconnected. That is worth a sentence of its own, because it is more than the other four
  // give away.
  'connection:changed': { text: 'See which of this node’s connected accounts change status or are removed', icon: 'radio' },
  // Each sentence names what the payload gives away, since that is what the owner is consenting to.
  'head:changed': { text: 'See when a task’s branch gets a new commit, and which commit', icon: 'radio' },
  'run:changed': { text: 'See when a task’s dev processes start or stop', icon: 'radio' },
  'agent-session:changed': { text: 'See when an agent in a task finishes a turn or needs attention', icon: 'radio' },
  'project:changed': { text: 'Receive notice when a project or its settings change', icon: 'radio' },
} as const satisfies Record<SubscribableChannel, GrantDescription>

/** One of the shell's own channels. Stays a narrow predicate, because its callers go on to index
 *  `ClientEventMap` with what it accepted. */
export const isSubscribable = (channel: string): channel is SubscribableChannel =>
  (SUBSCRIBABLE_CHANNELS as readonly string[]).includes(channel)

// The node side of the same grant list. `permissions.events` is one vocabulary across both sides of
// the wire (node-core/server/pluginHost/context.ts § on), so a manifest naming one of these is asking for
// its node half to hear a core event, not for its frame to subscribe to anything.
//
// `tasks:changed`, `connection:changed` and the four after them are in both lists, which is what a node-emitted fact looks
// like: the same name, the same sentence, one grant, and either half of the plugin may take it up.
// `plugins:changed` is not in the frame list because a frame has no roster to reconcile. That is the
// shell's job, and it does it whether or not a plugin asked. The two below are node-only for a
// different reason each: a session roster moving is machine-rate, and a frame that wanted the dirty
// markers has core's own task-status route.
const NODE_EVENT_DESCRIPTIONS: Readonly<Record<string, GrantDescription>> = {
  'plugins:changed': { text: 'Receive notice when this node’s plugin set changes', icon: 'radio' },
  'terminal:sessions-changed': { text: 'See when a terminal session starts, exits, or goes quiet', icon: 'radio' },
  'worktree:status-changed': { text: 'See when the files in a task’s checkout change, and which task', icon: 'radio' },
}

// `ownerId` is the plugin whose manifest names the channel. Without it, every plugin channel reads as the
// plugin's own, which is what the two callers that only have a permissions block get.
export const describeChannel = (channel: string, ownerId?: string): GrantDescription | undefined => {
  if (isSubscribable(channel)) return CHANNEL_DESCRIPTIONS[channel]
  if (isNodeEventChannel(channel)) return NODE_EVENT_DESCRIPTIONS[channel]
  // One host-owned sentence rather than one per verb. The verb is manifest text, and every sentence the
  // trust prompt draws under "Enforced" has to be copy the host owns (plugins/permissions.ts says why),
  // so it does not get interpolated in however well-formed it parsed.
  //
  // Another plugin's channel gets the same treatment at the producer grain
  // (docs/plugins.md § Hearing another plugin): the plugin *id* is interpolated, because an id is
  // already rendered elsewhere and held to CHANNEL_PART by the parse, and the verb never is.
  const parsed = parsePluginChannel(channel)
  if (!parsed) return undefined
  return ownerId && parsed.pluginId !== ownerId
    ? { text: `Receive live updates from the ${parsed.pluginId} plugin`, icon: 'radio' }
    : { text: 'Receive live updates from its own node half', icon: 'radio' }
}
