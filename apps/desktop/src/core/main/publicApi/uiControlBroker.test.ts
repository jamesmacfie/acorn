import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WsServerFrame } from '../../shared/ws'
import { UiControlBroker } from './uiControlBroker'

type CommandFrame = Extract<WsServerFrame, { channel: 'ui:command' }>

const snapshot = (revision: number) => ({ windowId: 'w1', primary: true, revision })

describe('UiControlBroker', () => {
  afterEach(() => vi.useRealTimers())

  it('rejects invocation when no renderer is connected', () => {
    const broker = new UiControlBroker()
    expect(() => broker.invoke({ commandId: 'core.pane.show', input: {} })).toThrow(/No renderer/)
    expect(broker.rendererConnected).toBe(false)
  })

  it('crosses a command to the renderer and resolves on its acknowledgement', async () => {
    const broker = new UiControlBroker()
    let sent: CommandFrame | null = null
    broker.register('w1', true, snapshot(0), (f) => (sent = f))
    expect(broker.rendererConnected).toBe(true)

    const p = broker.invoke({ commandId: 'core.pane.show', input: { paneId: 'pr' } })
    expect(sent).toMatchObject({ channel: 'ui:command', windowId: 'w1', commandId: 'core.pane.show', input: { paneId: 'pr' } })

    broker.resolveResult({ requestId: sent!.requestId, ok: true, result: { changed: true }, revision: 1 })
    const result = await p
    expect(result).toMatchObject({ commandId: 'core.pane.show', targetWindowId: 'w1', presentationRevision: 1, result: { changed: true } })
    // The stored snapshot updates via ui:state; a fresh state bumps snapshot() to revision 1.
    broker.updateState('w1', snapshot(1))
    expect(broker.snapshot()).toMatchObject({ revision: 1 })
  })

  it('rejects a stale expectedRevision with presentation_revision_conflict', () => {
    const broker = new UiControlBroker()
    broker.register('w1', true, snapshot(3), () => {})
    expect(() => broker.invoke({ commandId: 'core.pane.show', input: {}, expectedRevision: 2 })).toThrow(/revision is 3/)
  })

  it('times out when the renderer never acknowledges', async () => {
    vi.useFakeTimers()
    const broker = new UiControlBroker()
    broker.register('w1', true, snapshot(0), () => {})
    const p = broker.invoke({ commandId: 'core.pane.show', input: {} })
    const assertion = expect(p).rejects.toMatchObject({ code: 'ui_command_timeout' })
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
  })

  it('fails pending commands when the target window disconnects', async () => {
    const broker = new UiControlBroker()
    broker.register('w1', true, snapshot(0), () => {})
    const p = broker.invoke({ commandId: 'core.pane.show', input: {} })
    broker.disconnect('w1')
    await expect(p).rejects.toMatchObject({ code: 'ui_unavailable' })
    expect(broker.rendererConnected).toBe(false)
  })

  it('reports connected window summaries', () => {
    const broker = new UiControlBroker()
    broker.register('w1', true, snapshot(0), () => {})
    broker.register('w2', false, { windowId: 'w2', primary: false, revision: 0 }, () => {})
    expect(broker.snapshots().map((s) => s.windowId).sort()).toEqual(['w1', 'w2'])
  })
})
