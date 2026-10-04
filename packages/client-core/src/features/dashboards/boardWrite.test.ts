import { createRoot } from 'solid-js'
import { expect, it, vi } from 'vitest'
import type { DashboardDisplayRow } from '@acorn/dashboards-core/render'
import { createBoardWrite } from './boardWrite'
import type { BoardMove } from './boardMoves'

const row: DashboardDisplayRow = { id: 'one', pluginId: 'github', sourceId: 'pulls', values: {} }
const move: BoardMove = { ref: { pluginId: 'github', sourceId: 'pull-requests', recordId: 'one' },
  field: '/state', expected: 'open', target: 'closed', risk: 'write', sourceLabel: 'GitHub', choiceId: 'closed', columnId: 'state' }

it('cancels before dispatch, reuses a failed intent key, and rolls back before retry', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValueOnce('done')
  const optimistic = vi.fn()
  const message = vi.fn()
  const refresh = vi.fn().mockResolvedValue(undefined)
  const controller = createRoot(dispose => ({
    write: createBoardWrite({ resolve: () => ({ move }), send, refresh, onOptimistic: optimistic,
      onMessage: message, key: () => 'key-one', now: () => 10 }), dispose,
  }))
  controller.write.request(row, 'closed')
  expect(controller.write.pending()?.key).toBe('key-one')
  controller.write.cancel()
  expect(controller.write.pending()).toBeUndefined()
  expect(send).not.toHaveBeenCalled()

  controller.write.request(row, 'closed')
  await controller.write.send(controller.write.pending()!)
  expect(controller.write.retry()?.key).toBe('key-one')
  expect(optimistic).toHaveBeenLastCalledWith(undefined)
  expect(message).toHaveBeenLastCalledWith('GitHub: Provider unavailable')
  await controller.write.send(controller.write.retry()!)
  expect(send.mock.calls.map(([intent]) => intent.key)).toEqual(['key-one', 'key-one'])
  expect(refresh).toHaveBeenCalledOnce()
  expect(controller.write.retry()).toBeUndefined()
  controller.dispose()
})

it('refuses missing mappings and stale writes, and gives changed intents new keys', async () => {
  const send = vi.fn().mockResolvedValue('stale')
  const message = vi.fn()
  const optimistic = vi.fn()
  let nextKey = 0
  const controller = createRoot(dispose => ({
    write: createBoardWrite({ resolve: (_row, choice) => choice === 'missing' ? { reason: 'No write value for GitHub here.' } : { move },
      send, refresh: vi.fn(), onOptimistic: optimistic, onMessage: message,
      key: () => `key-${++nextKey}`, now: () => 10 }), dispose,
  }))
  controller.write.request(row, 'missing')
  expect(message).toHaveBeenLastCalledWith('No write value for GitHub here.')
  expect(send).not.toHaveBeenCalled()
  controller.write.request(row, 'closed')
  const first = controller.write.pending()!
  await controller.write.send(first)
  expect(message).toHaveBeenLastCalledWith('GitHub: This record has moved since the board loaded. Refresh and try again.')
  expect(optimistic).toHaveBeenLastCalledWith(undefined)
  controller.write.request(row, 'closed')
  expect(controller.write.pending()!.key).not.toBe(first.key)
  controller.dispose()
})
