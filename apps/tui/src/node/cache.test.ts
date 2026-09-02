import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileCacheStorage } from './cache'

// The query cache's file store (./cache.ts): where a persisted partition lands, and what a reader sees
// while one is being written. The persister calls this while the renderer owns the terminal, so a
// half-written file is a shell drawing last week's rail — which is why the write is a rename.

describe('fileCacheStorage', () => {
  let dir: string
  const KEY = 'acorn-cache:11111111-2222-4333-8444-555555555555'
  const file = (): string => join(dir, `${encodeURIComponent(KEY)}.json`)

  beforeEach(() => { dir = join(mkdtempSync(join(tmpdir(), 'acorn-cache-')), 'cache') })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('names the file after the partition key, at 0600 in a 0700 directory', async () => {
    const store = fileCacheStorage(dir)
    await store.setItem(KEY, '{"one":1}')

    // The colon is encoded rather than trusted into a path: the key carries a node id.
    expect(existsSync(file())).toBe(true)
    expect(await store.getItem(KEY)).toBe('{"one":1}')
    expect(statSync(file()).mode & 0o777).toBe(0o600)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('leaves the previous value readable when a write is interrupted between temp and rename', async () => {
    const store = fileCacheStorage(dir)
    await store.setItem(KEY, '{"one":1}')

    // Exactly the state a crash mid-write leaves behind: the temp file written, the rename not run.
    writeFileSync(`${file()}.tmp`, '{"two":2}', { mode: 0o600 })

    expect(await store.getItem(KEY)).toBe('{"one":1}')
    // …and the next complete write replaces it and leaves nothing behind.
    await store.setItem(KEY, '{"three":3}')
    expect(await store.getItem(KEY)).toBe('{"three":3}')
    expect(existsSync(`${file()}.tmp`)).toBe(false)
  })

  it('never leaves a partial file under the real name', async () => {
    const store = fileCacheStorage(dir)
    await store.setItem(KEY, '{"one":1}')
    // A second write of a much larger payload, read back the instant it resolves. `rename` is atomic
    // within a directory, so the only two things a reader can ever see are the whole old value and
    // the whole new one.
    const big = JSON.stringify({ rows: Array.from({ length: 5_000 }, (_, at) => ({ at })) })
    const write = store.setItem(KEY, big)
    expect(readFileSync(file(), 'utf8')).toBe('{"one":1}')
    await write
    expect(readFileSync(file(), 'utf8')).toBe(big)
  })

  it('reads a missing partition as a cold start rather than an error', async () => {
    expect(await fileCacheStorage(dir).getItem(KEY)).toBeUndefined()
  })

  it('removes a partition, and removing one that is not there is not an error', async () => {
    const store = fileCacheStorage(dir)
    await store.setItem(KEY, '{"one":1}')
    await store.removeItem(KEY)
    expect(existsSync(file())).toBe(false)
    await expect(store.removeItem(KEY)).resolves.toBeUndefined()
  })
})
