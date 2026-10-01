import { randomUUID } from 'node:crypto'
import { WS_MAX_VIEWERS, type WsClientFrame, type WsSubscriptionIntent } from '@acorn/protocol/ws.ts'
import type { NodeTransportError } from '@acorn/protocol/broker.ts'
import { SubscriptionOutbox, type OutgoingFrame } from './subscriptionOutbox'

/** Owns disposable viewers and replay state for one authenticated Node connection. */
export class EventViewers {
  readonly defaultId = randomUUID()
  readonly outbox = new SubscriptionOutbox()
  multiplexed = false
  private probed = false
  private legacyOwner: string | null = null
  private readonly owners = new Map<string, Map<string, OutgoingFrame>>()

  constructor(private readonly reject: (viewerId: string, error: NodeTransportError) => void) {}

  setTransport(multiplexed: boolean): void {
    this.probed = true
    this.multiplexed = multiplexed
    this.legacyOwner = null
  }

  track(viewerId: string, frame: WsClientFrame, intent?: WsSubscriptionIntent, cleanup = false): OutgoingFrame | null {
    if (!this.owners.has(viewerId) && (cleanup || intent?.state === 'detached')) return null
    if (!this.admit(viewerId)) return null
    const entry = { viewerId, frame, ...(intent ? { intent } : {}) }
    const desired = this.owners.get(viewerId)!
    if (intent?.state === 'attached') desired.set(intent.key, entry)
    else if (intent) desired.delete(intent.key)
    return entry
  }

  wire(entry: OutgoingFrame): string | null {
    if (!this.admit(entry.viewerId)) return null
    if (this.multiplexed) return JSON.stringify({ channel: 'ws:viewer', viewerId: entry.viewerId, frame: entry.frame })
    this.legacyOwner = entry.viewerId
    return JSON.stringify(entry.frame)
  }

  reconnect(): void {
    this.outbox.seed([...this.owners.values()].flatMap((desired) => [...desired.values()]))
  }

  retire(viewerId: string): boolean {
    this.owners.delete(viewerId)
    this.outbox.retire(viewerId)
    const resetLegacy = this.legacyOwner === viewerId
    if (resetLegacy) this.legacyOwner = null
    return resetLegacy
  }

  clear(): void {
    this.owners.clear()
    this.outbox.clear()
    this.legacyOwner = null
  }

  externalId(viewerId: string): string | undefined { return viewerId === this.defaultId ? undefined : viewerId }
  legacyRecipient(): string | undefined { return this.legacyOwner ? this.externalId(this.legacyOwner) : undefined }

  private admit(viewerId: string): boolean {
    if (this.probed && !this.multiplexed && this.legacyOwner && this.legacyOwner !== viewerId) {
      this.retire(viewerId)
      this.reject(viewerId, { code: 'viewers_unsupported', message: 'This Node supports one event viewer. Upgrade the Node to use another window.' })
      return false
    }
    if (this.owners.has(viewerId)) return true
    if (this.owners.size >= WS_MAX_VIEWERS) {
      this.reject(viewerId, { code: 'viewer_limit', message: `This Node connection has reached its ${WS_MAX_VIEWERS}-viewer limit.` })
      return false
    }
    this.owners.set(viewerId, new Map())
    return true
  }
}
