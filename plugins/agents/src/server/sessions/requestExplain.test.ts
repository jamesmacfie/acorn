import { describe, expect, it, vi } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import type { AgentRequest } from '../../contract/wire.ts'
import { explainRequest } from './requestExplain'

const request = {
  kind: 'permission',
  title: 'git reset --hard origin/main',
  detail: 'execute',
} as AgentRequest

describe('request explanations', () => {
  it('asks about the stored request with the chosen model, and unwraps a fenced answer', async () => {
    const generateText = vi.fn(async (_request: Parameters<CoreServices['models']['generateText']>[0]) => ({
      text: '```markdown\nDiscards uncommitted work.\n```',
    }))
    const models = { generateText } as unknown as CoreServices['models']
    const signal = new AbortController().signal
    expect(
      await explainRequest(models, 'owner', request, { backendId: 'harness:codex', modelId: 'fast' }, signal),
    ).toEqual({ text: 'Discards uncommitted work.' })
    const call = generateText.mock.calls[0]![0]
    expect(call).toMatchObject({ userId: 'owner', backendId: 'harness:codex', input: { modelId: 'fast', signal } })
    expect(call.input.prompt).toBe('Kind: permission\nRequest: git reset --hard origin/main\nDetail: execute')
  })

  it('reports an empty answer instead of showing nothing', async () => {
    const models = { generateText: async () => ({ text: '  ' }) } as unknown as CoreServices['models']
    await expect(
      explainRequest(models, 'owner', request, { backendId: 'harness:codex' }, new AbortController().signal),
    ).rejects.toThrow('empty explanation')
  })
})
