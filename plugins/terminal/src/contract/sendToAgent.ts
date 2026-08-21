// terminal.sendToAgent: queue a text block into an agent session's pseudo-terminal
// (docs/plugins.md § Collaboration rules).
//
// Part of the terminal plugin's contract, the only surface another plugin may import. It carries the
// capability id and its signature, nothing executable.
//
// plugins/memory's launch injector pushes the combined task-context and repo-memory block into a
// fresh agent session, which means writing into a PTY the terminal plugin owns. Importing the engine
// would be a memory-to-terminal coupling edge, so the composition root used to supply `sendToAgent`
// as an app-level dep until terminal became a NodePlugin. It is one now, so this is that capability.
//
// Consumers resolve it with `capabilities.get()` at call time, not at init: plugin init order is
// undefined, so a consumer that caches at init may cache `undefined`.
import { capabilityId } from '@acorn/plugin-api/node'
import type { SendSubmit } from '../shared/send'

export type { SendSubmit }

// Fire and forget: 'after-ready' doesn't resolve until the session next goes idle, which may be
// minutes away or never. Delivery failures (no such session, session exited) are swallowed for the
// same reason, since the only caller is best-effort launch injection, which must never block or fail
// a session launch.
export type TerminalSendToAgent = (sessionId: string, text: string, submit: SendSubmit) => void

export const TERMINAL_SEND_TO_AGENT = capabilityId<TerminalSendToAgent>('terminal.sendToAgent')
