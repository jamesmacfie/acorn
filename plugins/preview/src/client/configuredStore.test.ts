import { expect, it, vi } from 'vitest'

const readJson = vi.fn()
vi.mock('@acorn/plugin-api/client', () => ({ readJson: () => readJson() }))

const { previewConfigured, previewConfiguredSchedule } = await import('./configuredStore')

it('follows the Node, keeps the last answer on a failure, and shows everywhere on a Node without the route', async () => {
  expect(previewConfigured('a')).toBe(false)

  readJson.mockResolvedValueOnce({ a: true, b: false })
  await previewConfiguredSchedule.run()
  expect([previewConfigured('a'), previewConfigured('b')]).toEqual([true, false])

  readJson.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }))
  await previewConfiguredSchedule.run()
  expect([previewConfigured('a'), previewConfigured('b')]).toEqual([true, false])

  readJson.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
  await previewConfiguredSchedule.run()
  expect([previewConfigured('a'), previewConfigured('b')]).toEqual([true, true])

  readJson.mockResolvedValueOnce({ a: false })
  await previewConfiguredSchedule.run()
  expect(previewConfigured('a')).toBe(false)
})
