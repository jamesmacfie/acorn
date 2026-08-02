import { describe, expect, it } from 'vitest'
import { parseAgentTranscript } from './transcriptImport'

describe('managed-agent transcript import', () => {
  it('parses Claude Code JSONL without importing tool payloads', () => {
    const parsed = parseAgentTranscript([
      JSON.stringify({ type: 'user', sessionId: 'claude-session', message: { role: 'user', content: 'Fix the bug' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', name: 'Edit' }] } }),
    ].join('\n'))
    expect(parsed).toEqual({
      providerSessionRef: 'claude-session',
      turns: [{ user: 'Fix the bug', assistant: ['Done.'] }],
    })
  })

  it('parses Codex rollout JSONL', () => {
    const parsed = parseAgentTranscript([
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-thread' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run tests' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tests pass.' }] } }),
    ].join('\n'))
    expect(parsed.providerSessionRef).toBe('codex-thread')
    expect(parsed.turns).toEqual([{ user: 'Run tests', assistant: ['Tests pass.'] }])
  })

  it('parses exported Markdown as explicitly historical turns', () => {
    expect(parseAgentTranscript('# Session\n\n## User\n\nHello\n\n## Assistant\n\nHi').turns)
      .toEqual([{ user: 'Hello', assistant: ['Hi'] }])
  })
})
