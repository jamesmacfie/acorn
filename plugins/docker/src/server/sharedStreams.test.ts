import { describe, expect, it } from 'vitest'
import type { WsServerFrame } from '@acorn/protocol/ws.ts'
import { SharedDockerStreams } from './sharedStreams'

function fixture() {
  const opened: { kind: string; ref: string; line(value: string): void; end(): void; stops: number }[] = []
  const streams = new SharedDockerStreams({ openStream: (kind, ref, line, end) => {
    const producer = { kind, ref, line, end, stops: 0 }
    opened.push(producer)
    return { stop: () => { producer.stops += 1 } }
  } })
  return { opened, streams }
}

describe('shared Docker stream producers', () => {
  it('joins viewers to one producer with a targeted exact bounded tail, including split surrogate chunks', () => {
    const { streams, opened } = fixture()
    const a: WsServerFrame[] = [], b: WsServerFrame[] = []
    const first = streams.attach('logs', 'container', (frame) => a.push(frame), () => {})
    opened[0].line('x'.repeat(512 * 1024))
    for (const chunk of ['海', '\ud83d', '\ude42', '\n', '\u0000']) opened[0].line(chunk)
    const beforeJoin = a.length
    const second = streams.attach('logs', 'container', (frame) => b.push(frame), () => {})
    expect(opened).toHaveLength(1)
    expect(a).toHaveLength(beforeJoin)
    expect(b).toEqual([{ channel: 'docker:log', id: 'container', data: ('x'.repeat(512 * 1024) + '海🙂\n\u0000').slice(-512 * 1024) }])
    first.stop(); first.stop()
    expect(opened[0].stops).toBe(0)
    opened[0].line('continuing')
    expect(b.at(-1)).toEqual({ channel: 'docker:log', id: 'container', data: 'continuing' })
    expect(a).toHaveLength(beforeJoin)
    second.stop(); second.stop()
    expect(opened[0].stops).toBe(1)
    const third = streams.attach('logs', 'container', () => {}, () => {})
    expect(opened).toHaveLength(2)
    third.stop()
  })

  it('shares stats independently from logs and replays only the latest valid sample to the joining viewer', () => {
    const { streams, opened } = fixture()
    const a: WsServerFrame[] = [], b: WsServerFrame[] = []
    const log = streams.attach('logs', 'container', () => {}, () => {})
    const first = streams.attach('stats', 'container', (frame) => a.push(frame), () => {})
    const producer = opened[1]
    producer.line(JSON.stringify({ CPUPerc: '1.50%', MemPerc: '10%', MemUsage: '1MiB / 10MiB', NetIO: '1kB / 2kB', BlockIO: '3kB / 4kB', PIDs: '2' }))
    producer.line(JSON.stringify({ CPUPerc: '5.50%', MemPerc: '12%', MemUsage: '1MiB / 10MiB', NetIO: '1kB / 2kB', BlockIO: '3kB / 4kB', PIDs: '2' }))
    producer.line('invalid sample')
    const second = streams.attach('stats', 'container', (frame) => b.push(frame), () => {})
    expect(opened).toHaveLength(2)
    expect(a).toHaveLength(2)
    expect(b).toEqual([a.at(-1)])
    first.stop(); second.stop(); log.stop()
    expect(opened.map((stream) => stream.stops)).toEqual([1, 1])
  })

  it('reports producer end once to each surviving subscriber and does not reuse an ended producer', () => {
    const { streams, opened } = fixture()
    const a: WsServerFrame[] = [], b: WsServerFrame[] = []
    let endedA = 0, endedB = 0
    const first = streams.attach('logs', 'container', (frame) => a.push(frame), () => { endedA += 1 })
    const second = streams.attach('logs', 'container', (frame) => b.push(frame), () => { endedB += 1 })
    opened[0].end(); opened[0].end()
    expect(endedA).toBe(1); expect(endedB).toBe(1)
    expect(a).toEqual([{ channel: 'docker:stream-end', id: 'container', kind: 'logs' }]); expect(b).toEqual(a)
    first.stop(); second.stop()
    const next = streams.attach('logs', 'container', () => {}, () => {})
    expect(opened).toHaveLength(2)
    opened[0].line('late stale output')
    next.stop()
  })

  it('unwinds a synchronous construction failure and does not retain a synchronously ended subscriber', () => {
    let opens = 0, stops = 0, ends = 0
    const streams = new SharedDockerStreams({ openStream: (_kind, _ref, _line, end) => {
      opens++
      if (opens === 1) throw new Error('construction failed')
      if (opens === 2) end()
      return { stop: () => { stops++ } }
    } })
    expect(() => streams.attach('logs', 'container', () => {}, () => {})).toThrow('construction failed')
    const ended = streams.attach('logs', 'container', () => {}, () => { ends++ })
    expect(ended.active).toBe(false)
    expect(ends).toBe(1)
    expect(stops).toBe(1)
    ended.stop()
    const live = streams.attach('logs', 'container', () => {}, () => {})
    expect(opens).toBe(3)
    expect(live.active).toBe(true)
    live.stop()
    expect(stops).toBe(2)
  })
})
