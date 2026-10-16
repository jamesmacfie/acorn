import { afterEach, expect, it, vi } from 'vitest'
import {
  instancePath,
  itemByCounterPath,
  itemInstancesPath,
  itemsPath,
  itemsSearchPath,
  projectPath,
  rollbarFetch,
  rollbarOperation,
  setRollbarApiTelemetry,
} from './index'

afterEach(() => {
  setRollbarApiTelemetry(undefined)
  vi.unstubAllGlobals()
})

it.each([
  [projectPath, 'project'],
  [itemsPath(2), 'items'],
  [itemsSearchPath('TypeError in checkout'), 'items.search'],
  [itemByCounterPath('142'), 'item_by_counter'],
  [itemInstancesPath('99', 5), 'item.instances'],
  [instancePath('7'), 'instance'],
  ['/deploys', 'other'],
])('files %s under %s', (path, operation) => {
  expect(rollbarOperation(path)).toBe(operation)
})

it('times a call by operation and status, never by path', async () => {
  const ends: unknown[] = []
  const startSpan = vi.fn(() => ({ traceId: 't', spanId: 's', end: (...args: unknown[]) => void ends.push(args) }))
  setRollbarApiTelemetry({ enabled: () => true, startSpan })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 })),
  )
  await rollbarFetch('token', itemsSearchPath('secret search'))
  expect(startSpan).toHaveBeenCalledWith('rollbar.api', { attrs: { operation: 'items.search', method: 'GET' } })
  expect(ends).toEqual([['error', { status: 503 }]])
})
