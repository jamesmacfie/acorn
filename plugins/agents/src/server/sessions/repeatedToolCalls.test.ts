import { describe, expect, it } from 'vitest'
import type { AgentToolCall } from '../../contract/wire.ts'
import { RepeatedToolCalls } from './repeatedToolCalls'

const call = (id: string, input: string | undefined, extra: Partial<AgentToolCall> = {}): AgentToolCall => ({
  id,
  title: 'git status',
  kind: 'execute',
  input,
  ...extra,
})

describe('repeated tool calls', () => {
  it('counts identical calls in a row and starts again after a different one', () => {
    const calls = new RepeatedToolCalls()
    expect(calls.observe('s', 't', call('a', 'git status'))?.count).toBe(1)
    expect(calls.observe('s', 't', call('b', 'git status'))?.count).toBe(2)
    expect(calls.observe('s', 't', call('c', 'git diff'))?.count).toBe(1)
    expect(calls.observe('s', 't', call('d', 'git status'))?.count).toBe(1)
  })

  it('counts a call once, on the first event that carries its input', () => {
    const calls = new RepeatedToolCalls()
    // Claude announces a call with no input and fills it in on the update.
    expect(calls.observe('s', 't', call('a', undefined, { title: 'Terminal' }))).toBeNull()
    expect(calls.observe('s', 't', call('a', 'git status'))).toEqual({ count: 1, title: 'git status' })
    // Codex repeats the input on completion.
    expect(calls.observe('s', 't', call('a', 'git status', { status: 'completed' }))).toBeNull()
    expect(calls.observe('s', 't', call('b', 'git status'))?.count).toBe(2)
  })

  it('treats a different kind or MCP name with the same input as a different call', () => {
    const calls = new RepeatedToolCalls()
    calls.observe('s', 't', call('a', '{}', { kind: 'mcp', name: 'task_current' }))
    expect(calls.observe('s', 't', call('b', '{}', { kind: 'mcp', name: 'local_changes' }))?.count).toBe(1)
    expect(calls.observe('s', 't', call('c', '{}', { kind: 'read', name: 'local_changes' }))?.count).toBe(1)
  })

  it('keeps a streak per subagent, so parallel children do not break each other', () => {
    const calls = new RepeatedToolCalls()
    calls.observe('s', 't', call('a', 'ls', { subagentId: 'one' }))
    calls.observe('s', 't', call('b', 'pwd', { subagentId: 'two' }))
    expect(calls.observe('s', 't', call('c', 'ls', { subagentId: 'one' }))?.count).toBe(2)
  })

  it('starts again on a new turn and after forget', () => {
    const calls = new RepeatedToolCalls()
    calls.observe('s', 't1', call('a', 'ls'))
    expect(calls.observe('s', 't2', call('b', 'ls'))?.count).toBe(1)
    calls.forget('s')
    expect(calls.observe('s', 't2', call('c', 'ls'))?.count).toBe(1)
  })
})
