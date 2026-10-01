import type { WsClientFrame, WsSubscriptionIntent } from '@acorn/protocol/ws.ts'

export type OutgoingFrame = { viewerId: string; frame: WsClientFrame; intent?: WsSubscriptionIntent }
type Segment = { entries: OutgoingFrame[]; positions: Map<string, number> }
const segment = (): Segment => ({ entries: [], positions: new Map() })
const identity = (entry: OutgoingFrame): string => JSON.stringify([entry.viewerId, entry.intent!.key])

/** Compacts subscription intent between commands without inspecting a channel payload. */
export class SubscriptionOutbox {
  private segments: Segment[] = [segment()]

  push(entry: OutgoingFrame): void {
    const last = this.segments.at(-1)!
    if (!entry.intent) {
      last.entries.push(entry)
      this.segments.push(segment())
      return
    }
    const key = identity(entry)
    const position = last.positions.get(key)
    if (position === undefined) {
      last.positions.set(key, last.entries.length)
      last.entries.push(entry)
    } else last.entries[position] = entry
  }

  // A fresh physical socket has no subscriptions. Seed surviving state before any queued commands;
  // later intent in the first segment replaces it before a snapshot can be requested.
  seed(entries: OutgoingFrame[]): void {
    const queued = this.segments
    this.segments = [segment()]
    for (const entry of entries) this.push(entry)
    for (const part of queued) for (const entry of part.entries) this.push(entry)
  }

  retire(viewerId: string): void {
    const queued = this.segments.flatMap((part) => part.entries).filter((entry) => entry.viewerId !== viewerId)
    this.segments = [segment()]
    for (const entry of queued) this.push(entry)
  }

  drain(): OutgoingFrame[] {
    const attached = new Set<string>()
    const result: OutgoingFrame[] = []
    for (const part of this.segments) for (const entry of part.entries) {
      if (!entry.intent) { result.push(entry); continue }
      const key = identity(entry)
      if (entry.intent.state === 'attached') { attached.add(key); result.push(entry) }
      else if (attached.delete(key)) result.push(entry)
    }
    this.segments = [segment()]
    return result
  }

  clear(): void { this.segments = [segment()] }
}
