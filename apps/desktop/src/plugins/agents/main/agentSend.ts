// sendToAgent (docs/panes.md): THE shared delivery primitive — review notes, "add file/line to
// agent", and the context assembler all push text into an agent PTY through this. One bracketed
// paste block per send; three submit modes:
//   'now'         → paste, then '\r' after a short settle delay
//   'after-ready' → paste+submit immediately if the session is idle, else queue on the existing
//                   idle-detector edge (terminal.ts calls onIdle when a session flips idle)
//   'draft'       → paste only; the user reviews and hits enter
// Deps-injected (a session is just write/running/idle) so the logic tests under plain Node.
import { wrapBracketedPaste } from '../../terminal/main/terminalUtils'

export type SendSubmit = 'now' | 'after-ready' | 'draft'

export type SendableSession = {
  write(data: string): void
  running(): boolean
  idle(): boolean
}

export type SendResult = { ok: true; queued: boolean } | { ok: false; reason: string }

export class AgentSender {
  private pending = new Map<string, string[]>() // sessionId → sanitized blocks awaiting the idle edge

  constructor(
    private getSession: (id: string) => SendableSession | null,
    private submitDelayMs = 150,
    private schedule: (fn: () => void, ms: number) => void = (fn, ms) => setTimeout(fn, ms),
  ) {}

  private deliver(s: SendableSession, block: string, submit: boolean) {
    s.write(block)
    if (submit) this.schedule(() => s.running() && s.write('\r'), this.submitDelayMs)
  }

  send(sessionId: string, text: string, submit: SendSubmit): SendResult {
    const s = this.getSession(sessionId)
    if (!s || !s.running()) return { ok: false, reason: 'Session is not running.' }
    const block = wrapBracketedPaste(text)
    if (submit === 'draft') {
      this.deliver(s, block, false)
      return { ok: true, queued: false }
    }
    if (submit === 'now' || s.idle()) {
      this.deliver(s, block, true)
      return { ok: true, queued: false }
    }
    const queue = this.pending.get(sessionId) ?? []
    queue.push(block)
    this.pending.set(sessionId, queue)
    return { ok: true, queued: true }
  }

  // Called by the idle watcher when a session flips busy→idle: flush queued sends in order.
  onIdle(sessionId: string): void {
    const queue = this.pending.get(sessionId)
    if (!queue?.length) return
    this.pending.delete(sessionId)
    const s = this.getSession(sessionId)
    if (!s || !s.running()) return
    for (const block of queue) this.deliver(s, block, true)
  }

  // Session exited — its queue can never fire.
  clear(sessionId: string): void {
    this.pending.delete(sessionId)
  }

  queuedCount(sessionId: string): number {
    return this.pending.get(sessionId)?.length ?? 0
  }
}
