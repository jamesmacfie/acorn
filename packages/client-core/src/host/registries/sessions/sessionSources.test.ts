// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createSignal } from 'solid-js'
import { setActiveNode } from '../../../infra/node/activeNode'
import { agentSessionsFor, focusSession, isSettingUp, refreshSessionSources, registerSessionSource, sendToSession, sessionSummaries, type SessionSummary, type SessionSource } from './sessionSources'

const disposals: { dispose(): void }[] = []
afterEach(() => { for (const disposal of disposals.splice(0)) disposal.dispose(); setActiveNode(null) })
const row = (nodeId: string, sessionId = 'same'): Omit<SessionSummary, 'sourceId'> => ({
  nodeId, sessionId, taskId: 'task', title: 'Agent', running: true, createdAt: 1, agent: true, idle: false,
})
function source(id: string, value: ReturnType<typeof createSignal<Omit<SessionSummary, 'sourceId'>[]>>, actions: Partial<SessionSource> = {}): void {
  disposals.push(registerSessionSource(id, { summaries: value[0], ...actions }))
}

it('returns an empty roster when no source is registered', () => {
  setActiveNode('n1')
  expect(sessionSummaries()).toEqual([])
  expect(agentSessionsFor('task')).toEqual([])
})

it('keeps identical IDs on two nodes separate and refuses a stale action after switching', async () => {
  setActiveNode('n1')
  const rows = createSignal([row('n1'), row('n2')])
  const sent: string[] = []
  source('terminal', rows, { send: async (id) => { sent.push(id); return { ok: true } }, focus: (id) => sent.push(`focus:${id}`) })
  const first = agentSessionsFor('task')[0]!
  expect(first.nodeId).toBe('n1')
  expect(await sendToSession(first, 'hello', 'now')).toEqual({ ok: true })
  setActiveNode('n2')
  expect(agentSessionsFor('task')[0]?.nodeId).toBe('n2')
  expect(await sendToSession(first, 'wrong', 'draft')).toMatchObject({ ok: false })
  expect(focusSession(first)).toBe(false)
  expect(sent).toEqual(['same'])
})

it('removes actions on source disposal and when a refresh removes the row', async () => {
  setActiveNode('n1')
  const rows = createSignal([row('n1')])
  source('terminal', rows, { refresh: async () => { rows[1]([]) }, send: async () => ({ ok: true }) })
  const selected = sessionSummaries()[0]!
  await refreshSessionSources()
  expect(sessionSummaries()).toEqual([])
  expect(await sendToSession(selected, 'hello', 'after-ready')).toMatchObject({ ok: false })
  rows[1]([row('n1')])
  disposals.pop()!.dispose()
  expect(sessionSummaries()).toEqual([])
  expect(await sendToSession(selected, 'hello', 'draft')).toMatchObject({ ok: false })
})

it('does not dispatch a selected row to a replacement source after reload', async () => {
  setActiveNode('n1')
  const rows = createSignal([row('n1')])
  source('terminal', rows, { send: async () => ({ ok: true }) })
  const selected = sessionSummaries()[0]!
  disposals.pop()!.dispose()
  source('terminal', rows, { send: async () => ({ ok: true }) })
  expect(sessionSummaries()).toHaveLength(1)
  expect(await sendToSession(selected, 'hello', 'now')).toMatchObject({ ok: false })
})

it('takes setup classification from the source instead of inspecting a title', () => {
  setActiveNode('n1')
  const rows = createSignal<Omit<SessionSummary, 'sourceId'>[]>([{ ...row('n1'), title: 'anything', settingUp: true }])
  source('terminal', rows)
  expect(isSettingUp('task')).toBe(true)
  rows[1]([{ ...row('n1'), title: 'Setup', settingUp: false }])
  expect(isSettingUp('task')).toBe(false)
})
