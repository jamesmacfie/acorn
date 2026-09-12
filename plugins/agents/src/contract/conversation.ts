import { clientCapabilityId } from '@acorn/plugin-api/client'
import type { Component } from 'solid-js'

// One session's conversation, drawn by whoever has a session to draw.
//
// A capability rather than an import, because a plugin's `contract/` may not reach its own `client/`
// (tools/arch/boundaries.test.ts, "a plugin contract/ never re-exports its own internals") and the
// transcript, the queue and the composer all live there. So the contract carries the shape and this
// plugin's client half provides the component, lazily, the same way it registers a settings page.
//
// The key lives here, with the provider, which is the ordinary case: workflows already imports this
// plugin's contracts, so declaring it here creates no import that was not there
// (client-core infra/node/clientCapabilities.ts states the rule). WORKFLOW_CONTROL, next door, is the
// exception in the other direction.
//
// A consumer holds no session ids of its own until a step finishes, so it may name the step instead.
// Resolving that is this plugin's own business: it writes `config.workflowStepId` on the session when
// a step starts it (../server/sessions/sessionExecute.ts), and the client roster carries every session
// on the node, so the answer needs no request and arrives while the step is still running.

export type AgentConversationProps = {
  /** The session to draw, when the caller knows it. */
  sessionId?: string
  /** The workflow step whose session to draw, for a caller that does not. Ignored when `sessionId` is
   *  given. */
  workflowStepId?: string
  /** Which surface is drawing this. It keys the transcript's remembered scroll place, so two panes
   *  open on one session do not drag each other's view about. */
  viewKeyPrefix: string
  /** Refuse typing, with the composer still drawn. For a caller that knows sending is a bad idea right
   *  now. */
  composerDisabled?: boolean
  /** A line directly above the box, for a caller with something to say about sending right now. */
  note?: string
  /** What to say when there is no session to draw. The caller knows why there isn't one and this
   *  plugin does not, so the words are theirs. */
  noSession?: string
}

export type AgentConversationSurface = {
  Conversation: Component<AgentConversationProps>
}

export const AGENTS_CONVERSATION = clientCapabilityId<AgentConversationSurface>('agents.conversation')
