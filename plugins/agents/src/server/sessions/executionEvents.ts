import type { StreamEvent } from '@acorn/plugin-api/node'
import type { AgentEventRecord, AgentWsFrame } from '../../contract/wire'

/** Owns the enqueue/turn-id gap without replaying final capture through the live callback. */
export class ExecutionEvents {
  private pending = true
  private buffered: AgentEventRecord[] = []
  private lastSeq: number
  private readonly turnIds = new Set<string>()

  constructor(private readonly sessionId: string, afterSeq: number, private readonly onEvent?: (event: StreamEvent) => void) {
    this.lastSeq = afterSeq
  }

  beginEnqueue(): void { this.pending = true }

  acceptTurn(turnId: string): void {
    this.turnIds.add(turnId)
    this.pending = false
    const buffered = this.buffered
    this.buffered = []
    for (const event of buffered) this.forward(event)
  }

  receive(frame: AgentWsFrame): void {
    if (!this.onEvent || frame.channel !== 'agent:event' || frame.event.sessionId !== this.sessionId) return
    if (this.pending) this.buffered.push(frame.event)
    else this.forward(frame.event)
  }

  private forward(record: AgentEventRecord): void {
    if (!this.turnIds.has(record.turnId ?? '') || record.seq <= this.lastSeq) return
    this.lastSeq = record.seq
    this.onEvent?.({ type: 'managed-agent', sessionId: this.sessionId, sequence: record.seq, event: record.event })
  }
}
