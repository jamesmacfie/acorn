// The `agents:session-messenger` point: how a plugin queues an attributed note on an agent session
// (docs/managed-agents/session-messages.md).
import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

/** One note. The host writes the turn's visible text; `text` reaches the agent only as fenced context. */
export type SessionMessage = {
  taskId: string
  sessionId: string
  /** What the agent reads. At most 8 KiB of UTF-8, delivered as untrusted context, never as the person's words. */
  text: string
  /** A short, single-line subject for the visible text, such as "permission refused". */
  subject: string
  /** Scoped by the host to the calling plugin, so two plugins can't collide or suppress each other. */
  idempotencyKey: string
}

/**
 * The refusals are coarse on purpose. `unknown-session` covers a missing session and one that isn't in
 * the named task, so a plugin learns nothing about a row it may not see.
 */
export type SessionMessageResult =
  | { ok: true; turnId: string }
  | {
      ok: false
      reason: 'unknown-session' | 'archived' | 'not-controlled' | 'unattended-not-supported' | 'cap' | 'vetoed'
    }

/** What the host hands a contributor, bound to its plugin id. It stops working when the entry goes. */
export type SessionMessenger = {
  queue(message: SessionMessage): Promise<SessionMessageResult>
}

/** A contribution receives its sender here, once per connection. A reload connects the new entry again. */
export type SessionMessengerContribution = {
  connect(sender: SessionMessenger): void | Promise<void>
}

export const AGENTS_SESSION_MESSENGER = extensionPointId<SessionMessengerContribution>('agents:session-messenger')

/** Accepted notes per plugin per session. A duplicate key returns its turn and doesn't count again. */
export const MAX_PLUGIN_MESSAGES_PER_SESSION = 20
export const MAX_SESSION_MESSAGE_BYTES = 8 * 1024
export const MAX_SESSION_MESSAGE_SUBJECT = 80
