// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { setActiveNode } from '@acorn/plugin-api/testkit/client'
import { addSession, clearSessions, refreshSessions, sessionNode, sessions } from './sessionStore'
import type { TerminalSession } from '../contract/wire'

const row = (id: string): TerminalSession => ({
  id, taskId: 'task', title: 'Agent', kind: 'agent', profileId: 'codex', backend: 'node-pty',
  status: 'running', idle: false, agentState: 'working', isWorktree: true,
  cwd: '/task', command: 'codex', cols: 80, rows: 24, createdAt: 1, exitCode: null,
})
const response = (rows: TerminalSession[]) => new Response(JSON.stringify(rows), {
  status: 200, headers: { 'content-type': 'application/json' },
})
afterEach(() => { clearSessions(); setActiveNode(null); vi.unstubAllGlobals() })

it('replaces full rows and removes them when the node returns an empty roster', async () => {
  setActiveNode('n1')
  const answers = [response([row('same')]), response([])]
  vi.stubGlobal('fetch', vi.fn(async () => answers.shift()!))
  await refreshSessions()
  expect(sessions().map((session) => session.id)).toEqual(['same'])
  await refreshSessions()
  expect(sessions()).toEqual([])
})

it('retains authoritative rows after a failed refresh', async () => {
  setActiveNode('n1')
  const fetch = vi.fn().mockResolvedValueOnce(response([row('same')])).mockRejectedValueOnce(new Error('offline'))
  vi.stubGlobal('fetch', fetch)
  await refreshSessions()
  await expect(refreshSessions()).rejects.toThrow('offline')
  expect(sessions()).toEqual([row('same')])
})

it('drops a late response and a late created session from the previous node', async () => {
  setActiveNode('n1')
  let finish!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve })))
  const pending = refreshSessions()
  setActiveNode('n2')
  clearSessions()
  finish(response([row('same')]))
  await pending
  addSession(row('same'), 'n1')
  expect(sessions()).toEqual([])
  expect(sessionNode()).toBeNull()
})
