import type { EventPublisher } from '../../server/publicApi/defineEndpoint'

// Typed in-process event bus + bounded replay ring (docs/public-api.md). Endpoint handlers
// publish through the EventPublisher after a commit; the public WS hub subscribes and replays.
// Sequence is monotonic within one app run.

export type EventActor = { kind: 'browser' | 'internal' | 'api-token' | 'system'; id?: string }

export type PublishedEvent = {
  sequence: number
  at: number
  channel: string
  actor: EventActor
  resource?: { type: string; id: string }
  data: unknown
  // routing hints for filters (events.md §4)
  taskId?: string
  workspaceId?: string
}

const RING_MAX = 10_000
const RING_TTL_MS = 15 * 60_000

export class EventBus implements EventPublisher {
  private seq = 0
  private ring: PublishedEvent[] = []
  private readonly listeners = new Set<(e: PublishedEvent) => void>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  // EventPublisher surface used by endpoint handlers. Actor defaults to system; a richer actor can
  // be supplied via publishAs. ponytail: per-request actor tagging is a later refinement.
  publish(event: { channel: string; data: unknown; resource?: { type: string; id: string }; taskId?: string; workspaceId?: string }): void {
    this.publishAs({ kind: 'system' }, event)
  }

  publishAs(
    actor: EventActor,
    event: { channel: string; data: unknown; resource?: { type: string; id: string }; taskId?: string; workspaceId?: string },
  ): PublishedEvent {
    const at = this.now()
    const published: PublishedEvent = {
      sequence: ++this.seq,
      at,
      channel: event.channel,
      actor,
      ...(event.resource ? { resource: event.resource } : {}),
      data: event.data,
      ...(event.taskId ? { taskId: event.taskId } : {}),
      ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    }
    this.ring.push(published)
    this.trim(at)
    for (const l of this.listeners) l(published)
    return published
  }

  subscribe(listener: (e: PublishedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Replay retained events with sequence > after. Returns null if `after` predates the ring (the
  // caller must send 409 replay_unavailable) along with the oldest retained sequence.
  replay(after: number): { events: PublishedEvent[] } | { expired: true; oldestSequence: number } {
    const oldest = this.ring[0]
    if (oldest && after > 0 && after < oldest.sequence - 1) {
      return { expired: true, oldestSequence: oldest.sequence }
    }
    return { events: this.ring.filter((e) => e.sequence > after) }
  }

  get currentSequence(): number {
    return this.seq
  }

  private trim(now: number): void {
    const cutoff = now - RING_TTL_MS
    while (this.ring.length > RING_MAX || (this.ring[0] && this.ring[0].at < cutoff)) {
      this.ring.shift()
    }
  }
}
