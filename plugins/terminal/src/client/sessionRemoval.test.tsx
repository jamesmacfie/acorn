import { afterEach, expect, it, vi } from 'vitest'
import { _resetWsClient } from '@acorn/plugin-api/testkit/ws-client'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import { initSessions, refreshSessions, sessions } from './sessionStore'
import { holdTerminal, heldTerminalCount } from './heldTerminals'
import { initPtyChannel, wsAttach } from './wsChannel'
import type { TerminalSession } from '../contract/wire'

let roster: TerminalSession[] = []
let failRead = false

// These ownership gates supply a running terminal service; availability is covered by the host.
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@acorn/plugin-api/client')>(),
  hasHostCapability: () => true,
}))

vi.mock('./terminalClient', () => ({ terminalApi: () => ({ list: async () => {
  if (failRead) throw Error('offline')
  return roster
} }) }))
const stop: (() => void)[] = []
afterEach(() => { for (const dispose of stop.splice(0).reverse()) dispose(); setActiveNode(null); _resetWsClient(); delete (window as { acorn?: unknown }).acorn; roster = []; failRead = false })

it('keeps two attached readers on a failed roster and retires held ownership after successful removal', async () => {
  const sent: { channel: string }[] = []
  const frames: ((nodeId: string, frame: unknown) => void)[] = []
  Object.assign(window, { acorn: {
    desktop: true, nodeSend: (_node: string, frame: { channel: string }) => sent.push(frame), nodeFetch: () => Promise.reject(Error('unused')),
    onNodeFrame: (fn: (nodeId: string, frame: unknown) => void) => { frames.push(fn); return () => {} },
    onNodeBytes: () => () => {}, onNodeStatus: () => () => {},
  } })
  _resetWsClient(); setActiveNode('origin')
  stop.push(initPtyChannel(), initSessions())
  const id = '11111111-2222-3333-4444-555555555555'
  roster = [{ id, taskId: 'synthetic', title: 'Shell' }] as TerminalSession[]
  await refreshSessions()
  let retired = 0
  const first = wsAttach(id, () => {}, undefined, 'origin')
  const second = wsAttach(id, () => {}, undefined, 'origin')
  holdTerminal('origin', id, () => ({ nodeId: 'origin', sessionId: id, mounted: false, dispose: () => { retired++; first(); second() } }))
  expect(sent.filter(frame => frame.channel === 'term:attach')).toHaveLength(1)
  failRead = true
  for (const fn of frames) fn('origin', { channel: 'terminal:sessions-changed' })
  await new Promise(yes => setTimeout(yes, 0))
  expect(heldTerminalCount()).toBe(1)
  expect(retired).toBe(0)
  expect(sessions()).toHaveLength(1)
  failRead = false; roster = []
  for (const fn of frames) fn('origin', { channel: 'terminal:sessions-changed' })
  await new Promise(yes => setTimeout(yes, 0))
  expect(sessions()).toEqual([])
  expect(heldTerminalCount()).toBe(0)
  expect(retired).toBe(1)
  expect(sent.filter(frame => frame.channel === 'term:detach')).toHaveLength(1)
})
