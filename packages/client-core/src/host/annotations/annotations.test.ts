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
} from '../registries/extensionPoints/extensionPoints'
import type { Disposable } from '../../kit/lib/state/registry'

vi.mock('../plugins/surfaceFailures', () => ({ recordSurfaceFailure: vi.fn() }))

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

type ContributorOptions = {
  id?: string
  order?: number
  enabled?: () => boolean
  scope?: () => string
  revision?: () => number
}

const contributor = (
  pluginId: string,
  marks: (keys: unknown[], signal: AbortSignal) => Promise<PluginAnnotationMark[]>,
  options: ContributorOptions = {},
) => {
  const calls: unknown[][] = []
  const signals: AbortSignal[] = []
  const disposable = extensionRegistry.register({
    id: options.id ?? `plugin:${pluginId}:lines`,
    pluginId,
    point: POINT,
    label: `${pluginId} marks`,
    order: options.order ?? 500,
    carrier: 'items',
    ...(options.enabled ? { when: options.enabled } : {}),
    ...(options.scope ? { requestScope: options.scope } : {}),
    ...(options.revision ? { freshnessRevision: options.revision } : {}),
    marks: async (keys, signal) => {
      calls.push(keys)
      signals.push(signal)
      return marks(keys, signal)
    },
  } as ExtensionContribution)
  registered.push(disposable)
  return { calls, signals, disposable }
}

const key = (line: number) => ({ file: 'src/auth.ts', line, side: 'new' })

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
  clearAnnotations()
})

describe('requestAnnotations', () => {
  it('asks about two thousand keys in one request per contributor', async () => {
    point()
    const { calls } = contributor('coverage', async () => [])
    const keys = Array.from({ length: 2_000 }, (_, index) => key(index + 1))
    requestAnnotations(POINT, keys)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toHaveLength(2_000)
  })

  it('does not ask again for a key set it has already asked about', async () => {
    point()
    const { calls } = contributor('coverage', async () => [])
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
    const { calls } = contributor('coverage', async () => [])
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

  it('refetches only the contributor whose freshness revision changed', async () => {
    point()
    let coverageRevision = 0
    let lintRevision = 0
    const coverage = contributor('coverage', async () => [], { revision: () => coverageRevision })
    const lint = contributor('lint', async () => [], { revision: () => lintRevision })

    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(coverage.calls).toHaveLength(1))
    expect(lint.calls).toHaveLength(1)

    coverageRevision += 1
    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(coverage.calls).toHaveLength(2))
    expect(lint.calls).toHaveLength(1)
  })

  it('removes, disables and re-enables one contributor without clearing another', async () => {
    point()
    let coverageEnabled = true
    const coverage = contributor(
      'coverage',
      async () => [{ key: key(1), severity: 'warn', text: 'Not covered' }],
      { enabled: () => coverageEnabled },
    )
    contributor('lint', async () => [{ key: key(1), severity: 'danger', text: 'Unused import' }])

    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1))).toHaveLength(2))

    coverageEnabled = false
    requestAnnotations(POINT, [key(1)])
    expect(annotationsFor(POINT, key(1)).map((mark) => mark.pluginId)).toEqual(['lint'])

    coverageEnabled = true
    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(coverage.calls).toHaveLength(2))
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1)).map((mark) => mark.pluginId)).toEqual(['coverage', 'lint']))

    coverage.disposable.dispose()
    requestAnnotations(POINT, [key(1)])
    expect(annotationsFor(POINT, key(1)).map((mark) => mark.pluginId)).toEqual(['lint'])
  })

  it('does not reuse results when the same descriptor id is registered again', async () => {
    point()
    const first = contributor('coverage', async () => [{ key: key(1), severity: 'info', text: 'Old' }])
    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1))[0]?.text).toBe('Old'))

    first.disposable.dispose()
    const second = contributor('coverage', async () => [{ key: key(1), severity: 'info', text: 'New' }])
    requestAnnotations(POINT, [key(1)])
    expect(annotationsFor(POINT, key(1))).toEqual([])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1))[0]?.text).toBe('New'))
    expect(second.calls).toHaveLength(1)
  })

  it('lets the same registration refetch after an explicit clear', async () => {
    point()
    let text = 'Before clear'
    const coverage = contributor('coverage', async () => [{ key: key(1), severity: 'info', text }])
    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1))[0]?.text).toBe('Before clear'))

    clearAnnotations(POINT)
    expect(annotationsFor(POINT, key(1))).toEqual([])

    text = 'After clear'
    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1))[0]?.text).toBe('After clear'))
    expect(coverage.calls).toHaveLength(2)
  })

  it('clears a previous node synchronously and ignores its late answer', async () => {
    point()
    let node = 'node-a'
    const requests = [deferred<PluginAnnotationMark[]>(), deferred<PluginAnnotationMark[]>()]
    let request = 0
    const contribution = contributor('coverage', () => requests[request++]!.promise, { scope: () => node })

    requestAnnotations(POINT, [key(1)])
    expect(contribution.signals[0]?.aborted).toBe(false)
    node = 'node-b'
    requestAnnotations(POINT, [key(1)])
    expect(contribution.signals[0]?.aborted).toBe(true)
    expect(annotationsFor(POINT, key(1))).toEqual([])

    requests[1]!.resolve([{ key: key(1), severity: 'info', text: 'Node B' }])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1))[0]?.text).toBe('Node B'))
    requests[0]!.resolve([{ key: key(1), severity: 'danger', text: 'Node A late' }])
    await Promise.resolve()
    expect(annotationsFor(POINT, key(1))[0]?.text).toBe('Node B')
  })

  it('clears only a contributor whose replacement request fails', async () => {
    point()
    let revision = 0
    const coverage = contributor(
      'coverage',
      async () => revision === 0
        ? [{ key: key(1), severity: 'info', text: 'Covered' }]
        : Promise.reject(new Error('node unreachable')),
      { revision: () => revision },
    )
    contributor('lint', async () => [{ key: key(1), severity: 'danger', text: 'Unused import' }])
    requestAnnotations(POINT, [key(1)])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1))).toHaveLength(2))

    revision += 1
    requestAnnotations(POINT, [key(1)])
    expect(annotationsFor(POINT, key(1)).map((mark) => mark.pluginId)).toEqual(['lint'])
    await vi.waitFor(() => expect(coverage.calls).toHaveLength(2))
    expect(annotationsFor(POINT, key(1)).map((mark) => mark.pluginId)).toEqual(['lint'])
  })

  it('merges in registered contributor order rather than response order', async () => {
    point()
    const slow = deferred<PluginAnnotationMark[]>()
    const fast = deferred<PluginAnnotationMark[]>()
    contributor('first', () => slow.promise, { order: 10 })
    contributor('second', () => fast.promise, { order: 20 })
    requestAnnotations(POINT, [key(1)])

    fast.resolve([{ key: key(1), severity: 'warn', text: 'Second' }])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1)).map((mark) => mark.pluginId)).toEqual(['second']))
    slow.resolve([{ key: key(1), severity: 'info', text: 'First' }])
    await vi.waitFor(() => expect(annotationsFor(POINT, key(1)).map((mark) => mark.pluginId)).toEqual(['first', 'second']))
  })
})
