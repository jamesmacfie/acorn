import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginAnnotationMark } from '@acorn/protocol/extensionPoints.ts'
import {
  annotationsFor,
  clearAnnotations,
  requestAnnotations,
} from './annotations'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
} from '../../registries/extensionPoints'
import type { Disposable } from '../../registries/registry'

vi.mock('../surfaceFailures', () => ({ recordSurfaceFailure: vi.fn() }))

// Facts one plugin knows about the items another already draws (docs/plugins.md § Cooperative
// extension points, the `annotation` kind).
//
// The two things worth pinning: two thousand keys are one request per contributor, not two thousand,
// and a contributor that fails contributes nothing while the others still draw. A mark is a note under
// somebody else's row, and one plugin's outage must not blank the row.

const POINT = 'changes:diff-line'
const registered: Disposable[] = []

const point = () =>
  registered.push(extensionPointRegistry.register({
    id: POINT,
    ownerId: 'changes',
    label: 'Diff line',
    kind: 'annotation',
    key: ['file', 'line', 'side'],
    max: 4,
  }))

const contributor = (pluginId: string, marks: (keys: unknown[]) => Promise<PluginAnnotationMark[]>) => {
  const calls: unknown[][] = []
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:lines`,
    pluginId,
    point: POINT,
    label: `${pluginId} marks`,
    order: 500,
    carrier: 'items',
    marks: async (keys) => {
      calls.push(keys)
      return marks(keys)
    },
  } as ExtensionContribution))
  return calls
}

const key = (line: number) => ({ file: 'src/auth.ts', line, side: 'new' })

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
  clearAnnotations()
})

describe('requestAnnotations', () => {
  it('asks about two thousand keys in one request per contributor', async () => {
    point()
    const calls = contributor('coverage', async () => [])
    const keys = Array.from({ length: 2_000 }, (_, index) => key(index + 1))
    requestAnnotations(POINT, keys)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toHaveLength(2_000)
  })

  it('does not ask again for a key set it has already asked about', async () => {
    point()
    const calls = contributor('coverage', async () => [])
    requestAnnotations(POINT, [key(1), key(2)])
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    // The draw site's effect re-runs on every scroll and every thread toggle. Re-asking would be a
    // request per frame.
    requestAnnotations(POINT, [key(1), key(2)])
    expect(calls).toHaveLength(1)
    requestAnnotations(POINT, [key(1), key(2), key(3)])
    await vi.waitFor(() => expect(calls).toHaveLength(2))
  })

  it('stamps every mark with the plugin that sent it', async () => {
    point()
    contributor('coverage', async () => [{ key: key(42), severity: 'warn', text: 'Not covered' }])
    requestAnnotations(POINT, [key(42)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(42))).toHaveLength(1))
    expect(annotationsFor(POINT, key(42))[0]).toMatchObject({ pluginId: 'coverage', text: 'Not covered' })
  })

  it('draws nothing for a contributor that failed and everything for the ones that did not', async () => {
    point()
    contributor('coverage', async () => {
      throw new Error('node unreachable')
    })
    contributor('lint', async () => [{ key: key(42), severity: 'danger', text: 'Unused import' }])
    requestAnnotations(POINT, [key(42)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(42))).toHaveLength(1))
    expect(annotationsFor(POINT, key(42))[0]!.pluginId).toBe('lint')
  })

  it('says nothing about a point that is not an annotation point, or one nobody declared', async () => {
    const calls = contributor('coverage', async () => [])
    requestAnnotations(POINT, [key(1)])
    expect(calls).toHaveLength(0)
    expect(annotationsFor(POINT, key(1))).toEqual([])
  })

  it('keys a mark by the owner’s declared fields, so a stray field on a mark changes nothing', async () => {
    point()
    contributor('coverage', async () => [
      { key: { ...key(42), extra: 'ignored' }, severity: 'info', text: 'Covered' },
    ])
    requestAnnotations(POINT, [key(42)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(42))).toHaveLength(1))
  })
})
