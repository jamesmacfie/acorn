import { describe, expect, it, vi } from 'vitest'
import { codexModelPage, fetchCodexModels } from './codexModels'

describe('Codex model catalog', () => {
  it('reads picker-visible models and rejects a malformed response', () => {
    expect(codexModelPage({
      data: [
        { id: 'gpt-one', displayName: 'GPT One' },
        { model: 'gpt-two' },
        { id: 'hidden', hidden: true },
        { displayName: 'No id' },
      ],
      nextCursor: 'next',
    })).toEqual({
      models: [{ id: 'gpt-one', label: 'GPT One' }, { id: 'gpt-two', label: 'gpt-two' }],
      nextCursor: 'next',
    })
    expect(() => codexModelPage({ data: null })).toThrow('Codex returned no model catalog.')
  })

  it('collects pages and closes the app-server', async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({
      data: [{ id: 'gpt-one', displayName: 'GPT One' }], nextCursor: 'next',
    }).mockResolvedValueOnce({ data: [{ id: 'gpt-two', displayName: 'GPT Two' }], nextCursor: null })
    const notify = vi.fn()
    const stop = vi.fn().mockResolvedValue(undefined)
    const models = await fetchCodexModels('codex', () => ({ request, notify, stop }))
    expect(models).toEqual([{ id: 'gpt-one', label: 'GPT One' }, { id: 'gpt-two', label: 'GPT Two' }])
    expect(request).toHaveBeenNthCalledWith(2, 'model/list', { limit: 100, includeHidden: false })
    expect(request).toHaveBeenNthCalledWith(3, 'model/list', { limit: 100, includeHidden: false, cursor: 'next' })
    expect(notify).toHaveBeenCalledWith('initialized')
    expect(stop).toHaveBeenCalledOnce()
  })

  it('closes the app-server when discovery fails', async () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    await expect(fetchCodexModels('codex', () => ({
      request: vi.fn().mockRejectedValue(new Error('offline')),
      notify: vi.fn(),
      stop,
    }))).rejects.toThrow('offline')
    expect(stop).toHaveBeenCalledOnce()
  })
})
