import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { CompiledCoreServices } from '@acorn/plugin-api/node'
import type { AgentNormalizedEvent, AgentWaitFacts, AgentWsFrame } from '../../contract/wire'
import { ManagedAgentRuntime } from './runtime'
import { ManagedAgentEngine, type AgentRuntimeOptions } from './runtimeEngine'
import { managedAgentsBridge } from '../routes/managedBridge'

describe('authoritative managed waits', () => {
  let fixture: TestPluginDb
  let runtime: ManagedAgentRuntime
  let engine: ManagedAgentEngine
  // Frame listeners subscribed and not yet unsubscribed, so a test can see a wait let go of its listener.
  let listening: number
  const commit = (event: AgentNormalizedEvent, session = 'target') => engine.record(session, null, event)
  const frame = (frame: AgentWsFrame) => runtime.frames.emit(frame)
  beforeEach(() => {
    vi.useFakeTimers()
    fixture = makeTestPluginDb('agents')
    const options: AgentRuntimeOptions = {
      db: fixture.db,
      dataDir: fixture.dataDir,
      core: {} as CompiledCoreServices,
      internalEnv: () => ({}),
      secrets: {} as never,
      currentUserId: () => null,
    }
    engine = new ManagedAgentEngine(options)
    runtime = new ManagedAgentRuntime(options, engine)
    listening = 0
    const subscribe = runtime.frames.subscribe.bind(runtime.frames)
    vi.spyOn(runtime.frames, 'subscribe').mockImplementation((listener) => {
      const off = subscribe(listener)
      let subscribed = true
      listening++
      return () => {
        if (subscribed) listening--
        subscribed = false
        off()
      }
    })
    const insert = fixture.db.$client.prepare(
      `INSERT INTO agent_sessions (id,task_id,provider_id,profile_id,kind,driver_kind,driver_version,controller,runtime_state,attention,status_authority,title,config_json,created_at,updated_at) VALUES (?,'task','fake','fake','interactive','acp','test','acorn','ready','none','protocol','Synthetic','{}',0,0)`,
    )
    insert.run('target')
    insert.run('other')
  })
  afterEach(async () => {
    await runtime.stop()
    expect(listening).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    fixture.cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([501, 2_001])(
    'finds terminal authority beyond %i events without expanding the snapshot cap',
    async (count) => {
      for (let n = 0; n < count; n++)
        await runtime.store.recordEvent('target', null, { type: 'diagnostic', level: 'info', message: 'progress' })
      const terminal = await runtime.store.recordEvent('target', null, { type: 'turn_completed' })
      const snapshot = await managedAgentsBridge(runtime).wait('target', 0, 'turn_completed', 0)
      expect(snapshot.events).toHaveLength(500)
      expect(snapshot.wait).toEqual({
        until: 'turn_completed',
        afterSeq: 0,
        matched: true,
        terminal: { seq: terminal.seq, turnId: null, type: 'turn_completed' },
        eventsThroughSeq: terminal.seq,
        eventsComplete: false,
      })
      const next = await runtime.wait('target', terminal.seq, 'turn_completed', 0)
      expect(next.wait).toMatchObject({ matched: false, eventsComplete: true, terminal: null })
    },
  )

  it('coalesces a held read, ignores unrelated frames, and gives each waiter its own settlement', async () => {
    const read = runtime.store.waitFacts.bind(runtime.store)
    let release!: (facts: AgentWaitFacts) => void
    const heldFacts = await read('target', 0, 'turn_completed')
    const reads = vi.spyOn(runtime.store, 'waitFacts').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const first = runtime.wait('target', 0, 'turn_completed', 10_000)
    for (let n = 0; n < 20; n++) await commit({ type: 'diagnostic', level: 'info', message: 'progress' })
    await commit({ type: 'turn_completed' }, 'other')
    expect(reads).toHaveBeenCalledTimes(1)
    const second = runtime.wait('target', 0, 'turn_completed', 10_000)
    await commit({ type: 'turn_completed' })
    release(heldFacts)
    expect((await first).wait?.matched).toBe(true)
    expect((await second).wait?.matched).toBe(true)
    expect(listening).toBe(0)
    expect(reads.mock.calls.length).toBeLessThan(10)
  })

  it('settles timeout independently of a held read and cannot satisfy a replacement waiter', async () => {
    const facts = await runtime.store.waitFacts('target', 0, 'turn_completed')
    let release!: (value: AgentWaitFacts) => void
    vi.spyOn(runtime.store, 'waitFacts').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const first = runtime.wait('target', 0, 'turn_completed', 20)
    await vi.advanceTimersByTimeAsync(20)
    expect((await first).wait?.matched).toBe(false)
    const terminal = await commit({ type: 'turn_completed' })
    const replacement = runtime.wait('target', terminal.seq, 'turn_completed', 20)
    release({ ...facts, matched: true, terminal: { seq: terminal.seq, turnId: null, type: 'turn_completed' } })
    await vi.advanceTimersByTimeAsync(20)
    expect((await replacement).wait?.matched).toBe(false)
  })

  it.each(['cancel', 'stop', 'delete'] as const)(
    'cleans up immediately on %s while a read is held',
    async (operation) => {
      const facts = await runtime.store.waitFacts('target', 0, 'turn_completed')
      let release!: (value: AgentWaitFacts) => void
      vi.spyOn(runtime.store, 'waitFacts').mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      const controller = new AbortController()
      const pending = runtime.wait('target', 0, 'turn_completed', 10_000, controller.signal)
      const rejection = expect(pending).rejects.toBeInstanceOf(Error)
      if (operation === 'cancel') controller.abort(new Error('caller cancelled'))
      if (operation === 'stop') await runtime.stop()
      if (operation === 'delete') {
        await runtime.store.deleteSession('target')
        frame({ channel: 'agent:deleted', sessionId: 'target' })
      }
      await rejection
      expect(listening).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      release(facts)
      await Promise.resolve()
    },
  )

  it('cancellation of one waiter preserves the other and rejects pre-aborted callers', async () => {
    const controller = new AbortController()
    const first = runtime.wait('target', 0, 'turn_completed', 10_000, controller.signal)
    const second = runtime.wait('target', 0, 'turn_completed', 10_000)
    const rejection = expect(first).rejects.toThrow('cancelled')
    controller.abort(new Error('cancelled'))
    await rejection
    await expect(runtime.wait('target', 0, 'turn_completed', 0, controller.signal)).rejects.toThrow('cancelled')
    expect(listening).toBe(1)
    await commit({ type: 'turn_completed' })
    expect((await second).wait?.matched).toBe(true)
  })

  it('uses current ready, request attention, and stopped rows without matching an earlier turn', async () => {
    const prior = await commit({ type: 'turn_completed' })
    expect((await runtime.wait('target', prior.seq, 'turn_completed', 0)).wait?.matched).toBe(false)
    expect((await runtime.wait('target', prior.seq, 'ready', 0)).wait?.matched).toBe(true)
    await commit({ type: 'request', requestId: 'permission', kind: 'permission', title: 'Allow?' })
    const attention = await runtime.wait('target', prior.seq, 'attention', 0)
    expect(attention.wait?.matched).toBe(true)
    expect(attention.requests).toHaveLength(1)
    expect(attention.session.attention).toBe('permission')
    await commit({ type: 'session_state', state: 'stopped' })
    expect((await runtime.wait('target', prior.seq, 'stopped', 0)).wait?.matched).toBe(true)
    expect((await runtime.wait('target', prior.seq, 'turn_completed', 0)).wait?.matched).toBe(false)
  })

  it('releases listeners and timers when the authoritative read fails', async () => {
    vi.spyOn(runtime.store, 'waitFacts').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(runtime.wait('target', 0, 'turn_completed', 10_000)).rejects.toThrow('storage unavailable')
  })
})
