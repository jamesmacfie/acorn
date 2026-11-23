import { describe, expect, it } from 'vitest'
import type { AgentSession, AgentWsFrame } from '../../contract/wire.ts'
import { sessionListRow } from '../../shared/sessionList'
import { SessionFrames, type PublishedFrame } from './sessionFrames'

const model = (currentValue: string) => ({
  id: 'model',
  label: 'Model',
  category: 'model',
  currentValue,
  values: [
    { value: 'fast', label: 'Fast' },
    { value: 'deep', label: 'Deep' },
  ],
})

const row = (id: string, lastEventSeq: number, config: Record<string, unknown> = {}): AgentSession =>
  ({
    id,
    taskId: 't1',
    title: 'A session',
    config: { commands: [{ name: 'review' }], skills: [], configOptions: [model('fast')], ...config },
    lastEventSeq,
    subagents: [],
  }) as unknown as AgentSession

function frames() {
  const published: PublishedFrame[] = []
  const heard: AgentWsFrame[] = []
  const accepted: AgentWsFrame[] = []
  const frames = new SessionFrames({
    publish: (frame) => published.push(frame),
    webhooks: { accept: async (frame) => void accepted.push(frame) },
    store: { requireSession: async () => row('s1', 0) },
    shutdown: new AbortController().signal,
  })
  frames.subscribe((frame) => heard.push(frame))
  const send = (session: AgentSession) => frames.emit({ channel: 'agent:session', session })
  const socketRow = () => (published.at(-1) as { session: AgentSession }).session
  return { frames, published, heard, accepted, send, socketRow }
}

describe('a session row on the socket', () => {
  it('goes whole the first time, then as a list row while its detail stays the same', () => {
    const { send, socketRow } = frames()
    const first = row('s1', 1)
    send(first)
    expect(socketRow()).toBe(first)

    const next = row('s1', 2)
    send(next)
    expect(socketRow()).toEqual(sessionListRow(next))
  })

  it('goes whole again when the detail changes', () => {
    const { send, socketRow } = frames()
    send(row('s1', 1))
    const commands = row('s1', 2, { commands: [{ name: 'review' }, { name: 'ship' }] })
    send(commands)
    expect(socketRow()).toBe(commands)
    // A model switch moves only the chosen value, which a list row also carries, but it is sent whole.
    const switched = row('s1', 3, { commands: [{ name: 'review' }, { name: 'ship' }], configOptions: [model('deep')] })
    send(switched)
    expect(socketRow()).toBe(switched)
    const told = row('s1', 4, {
      commands: [{ name: 'review' }, { name: 'ship' }],
      configOptions: [model('deep')],
      standingContextTold: 'v2',
    })
    send(told)
    expect(socketRow()).toBe(told)
  })

  it('keeps each session to itself', () => {
    const { send, socketRow } = frames()
    send(row('s1', 1))
    const other = row('s2', 1)
    send(other)
    expect(socketRow()).toBe(other)
  })

  it('reaches the Node’s listeners and the webhooks whole every time', () => {
    const { send, heard, accepted } = frames()
    const first = row('s1', 1)
    const next = row('s1', 2)
    send(first)
    send(next)
    expect(heard.map((frame) => (frame as { session: AgentSession }).session)).toEqual([first, next])
    expect(accepted.map((frame) => (frame as { session: AgentSession }).session)).toEqual([first, next])
  })

  it('goes whole again after the session is deleted', () => {
    const { frames: sessionFrames, send, socketRow } = frames()
    send(row('s1', 1))
    sessionFrames.emit({ channel: 'agent:deleted', sessionId: 's1' })
    const recreated = row('s1', 1)
    send(recreated)
    expect(socketRow()).toBe(recreated)
  })
})
