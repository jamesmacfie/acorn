import { describe, expect, it } from 'vitest'
import type { BridgeAgentSession, BridgePendingRequest } from '@acorn/protocol/extensionBridge.ts'
import { chipTask } from './taskPages'

const match = {
  task: { id: 't1', title: 'Fix billing rounding', branch: null, projectId: 'p1', pages: [] },
  source: 'github',
}
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
