import { WS_MAX_VIEWERS } from '@acorn/protocol/ws.ts'
import type { StreamSink } from './wsHub'

// This token owns resources. Authentication and scope checks stay on its physical parent in wsHub.
export type EventViewer = { id: string | null; active: boolean; sinks: Map<string, StreamSink> }
const viewer = (id: string | null): EventViewer => ({ id, active: true, sinks: new Map() })

export class WsViewers {
  // The connection's own viewer. A connection that doesn't send `WS_VIEWERS_HEADER`, such as the
  // terminal client's or the CLI's, sends every frame through it.
  readonly single = viewer(null)
  private readonly viewers = new Map<string, EventViewer>()

  acquire(id: string): EventViewer | null {
    const held = this.viewers.get(id)
    if (held) return held
    if (this.viewers.size >= WS_MAX_VIEWERS) return null
    const created = viewer(id)
    this.viewers.set(id, created)
    return created
  }

  remove(id: string): EventViewer | undefined {
    const held = this.viewers.get(id)
    if (held) {
      held.active = false
      this.viewers.delete(id)
    }
    return held
  }

  all(): EventViewer[] {
    return [this.single, ...this.viewers.values()]
  }
  hasStream(id: string): boolean {
    return this.all().some((owner) => owner.sinks.has(id))
  }

  clear(retire: (viewer: EventViewer) => void): void {
    for (const owner of this.all()) {
      owner.active = false
      retire(owner)
    }
    this.viewers.clear()
  }
}
