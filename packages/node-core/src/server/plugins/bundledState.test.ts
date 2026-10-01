import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writePrivateAtomic } from '../storage/dataRoot'
import { bundledPluginStatePath, markBundledPluginInstalled, markPluginRemoved, markPluginUserManaged, readBundledPluginState } from './bundledState'

vi.mock('../storage/dataRoot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/dataRoot')>()
  return { ...actual, writePrivateAtomic: vi.fn(actual.writePrivateAtomic) }
})

let root = ''
const HASH = 'a'.repeat(64)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'acorn-bundled-state-'))
  vi.mocked(writePrivateAtomic).mockClear()
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('bundled ownership writes', () => {
  it('leaves an exact installed entry untouched', () => {
    markBundledPluginInstalled(root, 'example', '1', HASH, 100)
    const before = readFileSync(bundledPluginStatePath(root), 'utf8')
    vi.mocked(writePrivateAtomic).mockClear()

    markBundledPluginInstalled(root, 'example', '1', HASH, 100)

    expect(writePrivateAtomic).not.toHaveBeenCalled()
    expect(readFileSync(bundledPluginStatePath(root), 'utf8')).toBe(before)
  })

  it.each([
    { version: '2', fingerprint: HASH, installedAt: 100 },
    { version: '1', fingerprint: 'b'.repeat(64), installedAt: 100 },
    { version: '1', fingerprint: HASH, installedAt: 101 },
  ])('persists changed installed metadata: $version, $fingerprint, $installedAt', (entry) => {
    markBundledPluginInstalled(root, 'example', '1', HASH, 100)
    vi.mocked(writePrivateAtomic).mockClear()

    markBundledPluginInstalled(root, 'example', entry.version, entry.fingerprint, entry.installedAt)

    expect(writePrivateAtomic).toHaveBeenCalledTimes(1)
    expect(readBundledPluginState(root, 'example')).toEqual({ status: 'installed', ...entry })
  })

  it.each([markPluginUserManaged, markPluginRemoved])('persists a change from another ownership status', (mark) => {
    mark(root, 'example')
    const installedAt = readBundledPluginState(root, 'example')!.installedAt
    vi.mocked(writePrivateAtomic).mockClear()

    markBundledPluginInstalled(root, 'example', '1', HASH, installedAt)

    expect(writePrivateAtomic).toHaveBeenCalledTimes(1)
    expect(readBundledPluginState(root, 'example')).toEqual({ status: 'installed', version: '1', fingerprint: HASH, installedAt })
  })
})
