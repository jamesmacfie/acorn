import { beforeEach, describe, expect, it } from 'vitest'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import { captureStore } from './captures'

// The store, against the real chain the host migrates at boot. The retention sweep is the part worth
// a test: it runs on every write, and a wrong `notInArray` would either keep everything (an agent in a
// loop fills the owner's disk) or delete everything (the evidence a screenshot exists to be).

let db: PluginDatabase

// No manifest to validate: this is a compiled plugin, so its storage is the `migrationsModule` chain
// the testkit resolves from the package name rather than a declared one.
beforeEach(() => {
  db = makeTestNodeContext({ plugin: { name: 'browser' } }).storage.open()
})

const png = (byte: number): Buffer => Buffer.from([0x89, 0x50, 0x4e, 0x47, byte])

describe('the capture store', () => {
  it('round-trips the bytes under an id the tool can hand back', async () => {
    const store = captureStore(db)
    const { id } = await store.put({ taskId: 'task-1', mime: 'image/png', bytes: png(1) })

    const read = await store.read(id)
    expect(read).toMatchObject({ id, taskId: 'task-1', mime: 'image/png' })
    expect(read?.bytes.equals(png(1))).toBe(true)
    expect(await store.read('not-a-capture')).toBeNull()
  })

  it('keeps the newest twenty per task and forgets the rest', async () => {
    const store = captureStore(db)
    const ids: string[] = []
    for (let i = 0; i < 25; i += 1) {
      // Distinct timestamps, since the sweep orders by them and a 25-write loop finishes inside one
      // millisecond on any machine that would run this.
      await new Promise((resolve) => setTimeout(resolve, 2))
      ids.push((await store.put({ taskId: 'task-1', mime: 'image/png', bytes: png(i) })).id)
    }

    expect(await store.read(ids[4])).toBeNull()
    expect(await store.read(ids[5])).not.toBeNull()
    expect(await store.read(ids[24])).not.toBeNull()
  })

  it('counts one task at a time, so a busy task cannot evict a quiet one', async () => {
    const store = captureStore(db)
    const quiet = await store.put({ taskId: 'task-2', mime: 'image/png', bytes: png(0) })
    for (let i = 0; i < 25; i += 1) await store.put({ taskId: 'task-1', mime: 'image/png', bytes: png(i) })

    expect(await store.read(quiet.id)).not.toBeNull()
  })
})
