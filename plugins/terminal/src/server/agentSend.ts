// sendToAgent, the shared delivery primitive (docs/terminal/activity.md § Sending text to an
// agent). terminal.ts calls onIdle when a session flips idle, which flushes anything queued for
// 'after-ready'.
//
// A session is just write, running, and idle, injected as deps, so this tests under plain Node.
import { wrapBracketedPaste } from './terminalUtils'
import type { SendSubmit } from '../shared/send'

export type { SendSubmit }

export type SendableSession = {
  write(data: string): void
  running(): boolean
  idle(): boolean
}

export type SendResult = { ok: true; queued: boolean } | { ok: false; reason: string }

type ScheduledSubmit = { active: boolean; cancel?: () => void }

export class AgentSender {
  private pending = new Map<string, string[]>() // sessionId → sanitized blocks awaiting the idle edge

  private submits = new Map<string, Set<ScheduledSubmit>>()

  constructor(
    private getSession: (id: string) => SendableSession | null,
    private submitDelayMs = 150,
    private schedule: (fn: () => void, ms: number) => (() => void) | void = (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
  ) {}

  private deliver(sessionId: string, s: SendableSession, block: string, submit: boolean) {
    s.write(block)
    if (!submit) return
    const group = this.submits.get(sessionId) ?? new Set<ScheduledSubmit>()
    this.submits.set(sessionId, group)
    const operation: ScheduledSubmit = { active: true }
    group.add(operation)
    const finish = () => {
      group.delete(operation)
      if (!group.size && this.submits.get(sessionId) === group) this.submits.delete(sessionId)
    }
    try {
      operation.cancel = this.schedule(() => {
        if (!operation.active) return
        operation.active = false
        finish()
        if (this.getSession(sessionId) === s && s.running()) s.write('\r')
      }, this.submitDelayMs) || undefined
    } catch (error) {
      operation.active = false
      finish()
      throw error
    }
  }

  send(sessionId: string, text: string, submit: SendSubmit): SendResult {
    const s = this.getSession(sessionId)
    if (!s || !s.running()) return { ok: false, reason: 'Session is not running.' }
    const block = wrapBracketedPaste(text)
    if (submit === 'draft') {
      this.deliver(sessionId, s, block, false)
      return { ok: true, queued: false }
    }
    if (submit === 'now' || s.idle()) {
      this.deliver(sessionId, s, block, true)
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
    for (const block of queue) this.deliver(sessionId, s, block, true)
  }

  // Session exited. Its queue can never fire.
  clear(sessionId: string): void {
    this.pending.delete(sessionId)
    const group = this.submits.get(sessionId)
    this.submits.delete(sessionId)
    let failure: unknown
    for (const operation of group ?? []) {
      operation.active = false
      try { operation.cancel?.() } catch (error) { failure ??= error }
    }
    group?.clear()
    if (failure) throw failure
  }

  queuedCount(sessionId: string): number {
    return this.pending.get(sessionId)?.length ?? 0
  }
}
