import { beforeEach, describe, expect, it } from 'vitest'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import { captureStore } from './captures'

// The store, against the real chain the host migrates at boot. The retention sweep is the part worth a
// test: it runs on every write, and a wrong `notInArray` either keeps everything or deletes everything.

let db: PluginDatabase

// No manifest to validate: this is a compiled plugin, so the testkit resolves its `migrationsModule`
// chain from the package name.
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
      // Distinct timestamps, because the sweep orders by them and a 25-write loop finishes inside one
      // millisecond.
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
