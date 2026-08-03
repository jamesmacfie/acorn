// Node-side plugin event bus (docs/vNext/plugins.md § Cross-plugin collaboration, mechanism 2):
// plugins react to each other's facts by type string instead of by import.
//
// This is NOT wsBroadcast. wsBroadcast (main/wsHub.ts) fans out to connected CLIENTS and its frame
// vocabulary is part of the wire protocol; this bus is in-process, plugin↔plugin, and its payloads
// are ordinary TS values. Before it existed, core's notify.ts was the substitute: a plugin fact
// reached another plugin only by one of them importing the other, or by core importing both.
//
// Fire-and-forget with a per-listener try/catch, like the client's ClientEventBus: a subscriber that
// throws must not fail the publisher's request. Nothing is queued, ordered across types, or
// persisted — features needing durable ordered history own it in their own tables
// (docs/vNext/README.md § Non-goals, "Mixed queue/replication event bus").

import type { Disposable } from './capabilities'

// Same phantom-type trick as CapabilityId: the event type string carries its payload type, so the
// publisher and subscriber agree through the exporting plugin's contract/ rather than a shared enum
// in core. Core must not own a closed list of every plugin's event types.
export type NodeEventType<P> = string & { readonly __payload?: (payload: P) => void }

export const nodeEventType = <P>(type: string): NodeEventType<P> => type as NodeEventType<P>

export class NodeEventBus {
  readonly #listeners = new Map<string, Set<(payload: unknown) => void | Promise<void>>>()

  subscribe<P>(type: NodeEventType<P>, listener: (payload: P) => void | Promise<void>): Disposable {
    const set = this.#listeners.get(type) ?? new Set()
    this.#listeners.set(type, set)
    const erased = listener as (payload: unknown) => void | Promise<void>
    set.add(erased)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        set.delete(erased)
        if (!set.size) this.#listeners.delete(type)
      },
    }
  }

  // Synchronous dispatch, async listeners not awaited. A subscriber that needs the publisher to wait
  // is describing a capability call, not an event — use the capability registry for that.
  publish<P>(type: NodeEventType<P>, payload: P): void {
    const set = this.#listeners.get(type)
    if (!set) return
    for (const listener of [...set]) {
      try {
        const result = listener(payload)
        if (result instanceof Promise) result.catch((error) => console.warn(`[events] ${type} listener failed:`, error))
      } catch (error) {
        console.warn(`[events] ${type} listener failed:`, error)
      }
    }
  }

  types(): readonly string[] {
    return [...this.#listeners.keys()].sort()
  }
}
