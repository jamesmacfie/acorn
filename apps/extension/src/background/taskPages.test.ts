import { describe, expect, it } from 'vitest'
import type { BridgeAgentSession, BridgePendingRequest } from '@acorn/protocol/extensionBridge.ts'
import { appMarker, chipTask } from './taskPages'

const task = { id: 't1', title: 'Fix billing rounding', branch: null, projectId: 'p1', pages: [] }
const match = { task, page: { origin: 'https://github.com', pathPrefix: '/acme/runn/pull/482', source: 'github' } }
const session = (id: string, runtimeState: string) => ({ id, runtimeState }) as BridgeAgentSession
const request = (sessionId: string, taskId = 't1') => ({ sessionId, taskId }) as BridgePendingRequest

describe('the task chip', () => {
  it('names the task and links to it on the pane its page fits', () => {
    expect(chipTask('n1', match, undefined, [])).toEqual({
      title: 'Fix billing rounding',
      state: null,
      link: 'acorn://n1/t/t1?pane=pr',
    })
  })

  it('counts working agents, and agents waiting on the person ahead of them', () => {
    const sessions = [session('s1', 'working'), session('s2', 'working'), session('s3', 'ready')]
    expect(chipTask('n1', match, sessions, [request('s9', 'other')]).state).toEqual({ label: '2 working', tone: 'ok' })
    // A conversation is waiting while the Node holds a request from it, however many it holds.
    expect(chipTask('n1', match, sessions, [request('s2'), request('s2')]).state).toEqual({
      label: '1 waiting',
      tone: 'warn',
    })
  })
})

describe('the branch marker', () => {
  const app = {
    origin: 'https://runn-05ea41.runn.localhost:5104',
    pathPrefix: '/',
    source: 'runn',
    status: { label: 'Runn stack', state: 'starting', tone: 'warn' as const },
  }

  it("shows the task's branch and the plugin's state, and links to the plugin's pane", () => {
    expect(appMarker('n1', { task: { ...task, branch: 'fix/billing-rounding' }, page: app })).toEqual({
      branch: 'fix/billing-rounding',
      state: { label: 'starting', tone: 'warn' },
      link: 'acorn://n1/t/t1?pane=runn',
    })
  })

  it("names a task on the project's own checkout, and draws nothing for an item's page", () => {
    expect(appMarker('n1', { task, page: app })?.branch).toBe('Fix billing rounding')
    expect(appMarker('n1', match)).toBeNull()
  })
})
