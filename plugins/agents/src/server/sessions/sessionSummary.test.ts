import { describe, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { AgentSessionSnapshot } from '../../contract/wire.ts'
import { generateSessionSummary, sessionSummaryPrompt } from './sessionSummary'

const snapshot = (text = 'Implemented the dialog. Checks are still running.'): AgentSessionSnapshot => ({
  session: { title: 'Summary dialog', runtimeState: 'working', lastEventSeq: 42 },
  turns: [{ id: 'turn', ordinal: 0, status: 'running', input: [{ type: 'text', text: 'Add run summaries' }] }],
  events: [{ turnId: 'turn', seq: 42, event: { type: 'assistant_message', text } }],
  requests: [],
}) as unknown as AgentSessionSnapshot

describe('run summary generation', () => {
  it('captures work in progress and extra context, and returns copyable Markdown with its ledger boundary', async () => {
    const generateText = vi.fn(async (_request: Parameters<CoreServices['models']['generateText']>[0]) =>
      ({ text: '```markdown\n# Work so far\n\nChecks pending.\n```' }))
    const models = { generateText } as unknown as CoreServices['models']
    const signal = new AbortController().signal
    expect(await generateSessionSummary(models, 'owner', snapshot(), {
      backendId: 'harness:codex', modelId: 'fast', context: 'For the reviewer',
    }, signal)).toEqual({ markdown: '# Work so far\n\nChecks pending.', truncated: false, throughSeq: 42 })
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner', backendId: 'harness:codex',
      input: expect.objectContaining({ modelId: 'fast', signal, prompt: expect.stringContaining('For the reviewer') }),
    }))
    const { prompt } = generateText.mock.calls[0]![0]!.input
    expect(prompt).toContain('Add run summaries')
    expect(prompt).toContain('(running)')
    expect(prompt).toContain('Checks are still running.')
  })

  it('bounds long history while retaining the original objective and most recent work', () => {
    const { prompt, truncated } = sessionSummaryPrompt(snapshot(`Early decision\n${'x'.repeat(150_000)}\nRecent failure`), '')
    expect(truncated).toBe(true)
    expect(prompt).toContain('Add run summaries')
    expect(prompt).toContain('Early decision')
    expect(prompt).toContain('Recent failure')
    expect(prompt).toContain('[Middle history omitted')
    expect(prompt.length).toBeLessThan(121_000)
  })

  it('refuses an empty session before spending model usage', async () => {
    const generateText = vi.fn()
    await expect(generateSessionSummary({ generateText } as unknown as CoreServices['models'], 'owner',
      { ...snapshot(), turns: [] }, { backendId: 'harness:codex', context: '' }, new AbortController().signal))
      .rejects.toThrow('Send a message')
    expect(generateText).not.toHaveBeenCalled()
  })

  it('treats an empty provider answer as a retryable failure', async () => {
    const generateText = vi.fn(async () => ({ text: '   ' }))
    await expect(generateSessionSummary({ generateText } as unknown as CoreServices['models'], 'owner',
      snapshot(), { backendId: 'harness:codex', context: '' }, new AbortController().signal))
      .rejects.toThrow('empty summary')
  })
})
