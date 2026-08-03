// terminal.sendToAgent — queue a text block into an agent session's pseudo-terminal
// (docs/vNext/plugins.md § Cross-plugin collaboration).
//
// This file is part of the terminal plugin's CONTRACT: the only surface another plugin may import. It
// carries the capability id and its signature, nothing executable.
//
// It exists to close a seam that was open for a whole phase. plugins/memory's launch injector pushes
// the combined task-context + repo-memory block into a fresh agent session, which means writing into a
// PTY the terminal plugin owns. Importing the engine would be a memory→terminal coupling edge, so the
// composition root supplied `sendToAgent` as an app-level dep with a comment saying it could not become
// a capability until terminal was a NodePlugin. Terminal is one now, so this is that capability, and
// the dep is gone.
//
// Consumers resolve it with `capabilities.get()` at CALL time, not at init — plugin init order is
// undefined (server/plugin/capabilities.ts), so a consumer that caches at init may cache `undefined`.
import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { SendSubmit } from '../shared/send'

export type { SendSubmit }

// Fire-and-forget by design: 'after-ready' does not resolve until the session next goes idle, which
// may be minutes away or never, and no caller has anything useful to do with that. Delivery failures
// (no such session, session exited) are swallowed by the implementation for the same reason — the
// only caller is best-effort launch injection, which must never block or fail a session launch.
export type TerminalSendToAgent = (sessionId: string, text: string, submit: SendSubmit) => void

export const TERMINAL_SEND_TO_AGENT = capabilityId<TerminalSendToAgent>('terminal.sendToAgent')
