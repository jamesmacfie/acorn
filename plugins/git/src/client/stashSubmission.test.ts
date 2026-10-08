import { expect, it } from 'vitest'
import { createStashSubmission } from './stashSubmission'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

it('refreshes the captured Node and project without showing a late result after a scope switch', async () => {
  const lifetime = createStashSubmission()
  const pending = deferred<string>()
  let scope = 'old-node:old-project'
  const refreshed: string[] = [], visible: string[] = []
  const run = lifetime.run({ request: () => pending.promise,
    refreshCaptured: () => refreshed.push('old-node:old-project'),
    currentScope: () => scope === 'old-node:old-project',
    success: (value) => visible.push(value), failure: () => visible.push('error'), settled: () => visible.push('settled') })
  scope = 'new-node:new-project'
  lifetime.invalidate()
  pending.resolve('stale response')
  await run
  expect(refreshed).toEqual(['old-node:old-project'])
  expect(visible).toEqual([])
})

it('does not let a cancelled action close or overwrite a replacement dialog', async () => {
  const lifetime = createStashSubmission()
  const old = deferred<string>(), replacement = deferred<string>()
  const visible: string[] = []
  const submit = (request: () => Promise<string>) => lifetime.run({ request, refreshCaptured: () => {}, currentScope: () => true,
    success: (value) => visible.push(value), failure: () => visible.push('error'), settled: () => visible.push('settled') })
  const first = submit(() => old.promise)
  lifetime.invalidate()
  const second = submit(() => replacement.promise)
  old.resolve('old action')
  await first
  expect(visible).toEqual([])
  replacement.resolve('new action')
  await second
  expect(visible).toEqual(['new action', 'settled'])
})
