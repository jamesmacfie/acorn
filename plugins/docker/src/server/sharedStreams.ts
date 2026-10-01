import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import type { getDockerService } from './dockerService'
import { parseStatsLine } from './parse'
import { LogReplay } from './logReplay'

type Kind = 'logs' | 'stats'
type Subscriber = { send(frame: WsServerFrame): void; end(): void }
type Producer = { subscribers: Set<Subscriber>; handle?: { stop(): void }; replay?: LogReplay; sample?: WsServerFrame }
type Service = Pick<ReturnType<typeof getDockerService>, 'openStream'>
type Subscription = { readonly active: boolean; stop(): void }

/** One continuous producer per kind/container, independently owned viewer subscriptions. */
export class SharedDockerStreams {
  private readonly producers = new Map<string, Producer>()
  constructor(private readonly service: Service) {}

  attach(kind: Kind, id: string, send: Subscriber['send'], end: Subscriber['end']): Subscription {
    const key = `${kind}:${id}`
    let producer = this.producers.get(key)
    const subscriber = { send, end }
    if (producer) {
      producer.subscribers.add(subscriber)
      const replay = producer.replay?.text()
      if (replay) send({ channel: 'docker:log', id, data: replay })
      if (producer.sample) send(producer.sample)
    } else {
      producer = { subscribers: new Set([subscriber]), ...(kind === 'logs' ? { replay: new LogReplay() } : {}) }
      const owned = producer
      this.producers.set(key, owned)
      try { owned.handle = this.service.openStream(kind, id, (line) => {
        if (this.producers.get(key) !== owned) return
        let frame: WsServerFrame
        if (kind === 'logs') {
          owned.replay!.append(line)
          frame = { channel: 'docker:log', id, data: line }
        } else {
          const sample = parseStatsLine(line)
          if (!sample) return
          frame = { channel: 'docker:stats', id, sample }
          owned.sample = frame
        }
        for (const sub of owned.subscribers) sub.send(frame)
      }, () => {
        if (this.producers.get(key) !== owned) return
        this.producers.delete(key)
        for (const sub of owned.subscribers) { sub.send({ channel: 'docker:stream-end', id, kind }); sub.end() }
        owned.subscribers.clear()
      }) } catch (error) {
        if (this.producers.get(key) === owned) this.producers.delete(key)
        owned.subscribers.clear()
        throw error
      }
      // A service may end during construction, before it returns its handle.
      if (!owned.subscribers.size) owned.handle.stop()
    }
    const owned = producer
    return { get active() { return owned.subscribers.has(subscriber) }, stop: () => {
      if (!owned.subscribers.delete(subscriber)) return
      if (owned.subscribers.size) return
      if (this.producers.get(key) === owned) this.producers.delete(key)
      owned.handle?.stop()
    } }
  }
}
