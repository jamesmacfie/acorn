import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkInvariant, MOUNTED_CEILING, parseFlow, runFlow, summarizeReport } from './flow.mjs'

const stage = (steps) => ({ name: 'flow', stages: [{ name: 'one', steps }] })
const assertion = { assert: { surface: 'diff', invariant: 'noBlank' } }

describe('parsing a flow', () => {
  it('accepts the checked-in large-surface flow', async () => {
    const flow = parseFlow(await readFile(join(import.meta.dirname, 'flows', 'large-surfaces.json'), 'utf8'))
    expect(flow.stages.length).toBeGreaterThanOrEqual(6)
  })

  it('accepts the desktop comparison flow', async () => {
    const flow = parseFlow(await readFile(join(import.meta.dirname, 'flows', 'tui-navigation.json'), 'utf8'))
    expect(flow.stages.map((stage) => stage.name)).toEqual(['task-roster', 'changes', 'agent', 'workspace-switch'])
  })

  it('rejects an action it does not know', () => {
    expect(() => parseFlow(stage([{ hover: { target: { name: 'x' } } }, assertion]))).toThrow(/unknown action "hover"/)
  })

  it('rejects anything that could carry a script', () => {
    expect(() => parseFlow(stage([{ script: 'document.body.remove()' }, assertion]))).toThrow(/unknown action "script"/)
    expect(() => parseFlow(stage([{ click: { target: { name: 'Go' }, script: 'alert(1)' } }, assertion]))).toThrow(/unknown field "script"/)
    expect(() => parseFlow(stage([{ wait: { surface: 'diff', until: 'document.readyState', timeoutMs: 100 } }, assertion]))).toThrow(/until/)
  })

  it('rejects unbounded or nested loops', () => {
    expect(() => parseFlow(stage([{ repeat: { times: 1_000, steps: [{ frames: 1 }] } }, assertion]))).toThrow(/times/)
    expect(() => parseFlow(stage([{ repeat: { steps: [{ frames: 1 }] } }, assertion]))).toThrow(/times/)
    expect(() => parseFlow(stage([{ repeat: { times: 2, steps: [{ repeat: { times: 2, steps: [{ frames: 1 }] } }] } }, assertion]))).toThrow(/nest/)
    expect(() => parseFlow(stage([{ wait: { surface: 'diff', until: 'ready', timeoutMs: 10_000_000 } }, assertion]))).toThrow(/timeoutMs/)
  })

  it('rejects a flow that asserts nothing, or an invariant it does not know', () => {
    expect(() => parseFlow(stage([{ frames: 2 }]))).toThrow(/assert at least one/)
    expect(() => parseFlow(stage([{ assert: { surface: 'diff', invariant: 'fast' } }]))).toThrow(/invariant/)
  })

  it('rejects text checks with unknown fields or empty outcomes', () => {
    expect(() => parseFlow(stage([{ assertText: { contains: [] } }]))).toThrow(/contains or absent/)
    expect(() => parseFlow(stage([{ waitText: { text: 'ready', timeoutMs: 100, script: 'x' } }, assertion]))).toThrow(/script/)
  })

  it('rejects a step with two actions and a target with no name', () => {
    expect(() => parseFlow(stage([{ frames: 1, checkpoint: 'x' }, assertion]))).toThrow(/exactly one action/)
    expect(() => parseFlow(stage([{ click: { target: { role: 'button' } } }, assertion]))).toThrow(/name or nameStartsWith/)
  })
})

const entry = (overrides = {}) => ({
  kind: 'diff',
  topology: { files: 1, fixedRows: 100, dynamicBlocks: 0, ready: true, lateSourceBlocks: 0 },
  mounted: { segments: 0, fixedRows: 50, dynamicBlocks: 2, blankBlocks: 0, uncoveredRanges: 0 },
  work: { queuedSegments: 0, queuedEnrichment: 0, furthestQueueDistance: 0, scheduledFrames: 0, heldPublications: 0, prepareMs: 1 },
  measurement: { candidates: 1, reads: 1, commits: 1, maxCommitsInFrame: 1, readMs: 0, activeObservers: 1, observedElements: 2 },
  correction: { count: 0, failed: 0, maxPixels: 0, maxAnchorDrift: 0 },
  resident: { documents: 1, segments: 0, rows: 100, estimatedBytes: 200 },
  ...overrides,
})

describe('invariants', () => {
  it('decides each one from the snapshot alone', () => {
    const health = { surfaces: [entry({ measurement: { ...entry().measurement, maxCommitsInFrame: 3 } })], retired: {} }
    expect(checkInvariant(health, 'diff', 'noBlank').pass).toBe(true)
    expect(checkInvariant(health, 'diff', 'singleCommitPerFrame')).toEqual({ pass: false, detail: { maxCommitsInFrame: 3 } })
    expect(checkInvariant(health, 'diff', 'boundedMount').detail).toEqual({ mounted: 52, ceiling: MOUNTED_CEILING })
    expect(checkInvariant(health, 'timeline', 'noBlank').pass).toBe(false)
    expect(checkInvariant(health, 'diff', 'teardown').pass).toBe(false)
    const gone = { surfaces: [], retired: { diff: entry({ measurement: { ...entry().measurement, activeObservers: 0 } }) } }
    expect(checkInvariant(gone, 'diff', 'teardown').pass).toBe(true)
  })
})

describe('running a flow', () => {
  it('waits on health, records checkpoints and failed invariants, and finishes the flow', async () => {
    const calls = []
    let health = { surfaces: [], retired: {} }
    const client = {
      environment: async () => ({ userAgent: 'test' }),
      find: async (target) => { calls.push(`find ${target.name}`); return 'element-1' },
      click: async () => {
        calls.push('click')
        health = { surfaces: [entry({ measurement: { ...entry().measurement, maxCommitsInFrame: 2 } })], retired: {} }
      },
      fill: async () => {},
      frames: async () => {},
      surfaceHealth: async () => health,
      scrollToFraction: async (selector, fraction) => { calls.push(`scroll ${selector} ${fraction}`); return { scrollTop: 0, maxScroll: 10, viewport: 5 } },
      setWindowSize: async () => {},
      performanceEntries: async () => [],
    }
    const flow = parseFlow({
      name: 'test',
      stages: [
        { name: 'open', steps: [{ click: { target: { name: 'Changes' } } }, { wait: { surface: 'diff', until: 'ready', timeoutMs: 1_000 } }, { checkpoint: 'cold' }] },
        { name: 'sweep', steps: [{ scroll: { surface: 'diff', fractions: [0, 1], settleMs: 1_000 } }, { assert: { surface: 'diff', invariant: 'singleCommitPerFrame' } }] },
      ],
    })
    const report = await runFlow(client, flow, { fixture: { name: 'large-surfaces', profile: 'small', seed: 1, files: 22, fixedRows: 9_048, events: 281 } })
    expect(calls).toEqual(['find Changes', 'click', 'scroll .diff 0', 'scroll .diff 1'])
    expect(report.stages.map((item) => item.name)).toEqual(['open', 'sweep'])
    expect(report.stages[0].waits[0]).toMatchObject({ surface: 'diff', until: 'ready' })
    expect(report.stages[1].checkpoints.map((item) => item.name)).toEqual(['scroll 0', 'scroll 1'])
    expect(report.asserts.map((item) => [item.invariant, item.pass])).toEqual([['noBlank', true], ['noBlank', true], ['singleCommitPerFrame', false]])
    expect(report.failed).toBe(1)
    expect(summarizeReport(report)).toContain('FAILED sweep: diff singleCommitPerFrame {"maxCommitsInFrame":2}')
  })

  it('counts a windowed timeline as mounted when every turn is drawn or counted as hidden', async () => {
    const timeline = entry({
      kind: 'timeline',
      topology: { ...entry().topology, dynamicBlocks: 3_387 },
      mounted: { ...entry().mounted, fixedRows: 0, dynamicBlocks: 200 },
      window: { hiddenEarlier: 3_187, expansions: 0, trims: 0, pinned: 0 },
    })
    const client = { environment: async () => null, frames: async () => {}, surfaceHealth: async () => ({ surfaces: [timeline], retired: {} }), performanceEntries: async () => [] }
    const flow = parseFlow(stage([{ wait: { surface: 'timeline', until: 'mounted', timeoutMs: 1_000 } }, { assert: { surface: 'timeline', invariant: 'boundedMount' } }]))
    const report = await runFlow(client, flow)
    expect(report.asserts.map((item) => [item.invariant, item.pass])).toEqual([['boundedMount', true]])
  })

  it('fails a wait that never comes true, naming the condition', async () => {
    const client = { environment: async () => null, frames: async () => {}, surfaceHealth: async () => ({ surfaces: [], retired: {} }), performanceEntries: async () => [] }
    const flow = parseFlow(stage([{ wait: { surface: 'diff', until: 'ready', timeoutMs: 1 } }, assertion]))
    await expect(runFlow(client, flow)).rejects.toThrow(/diff was not ready within 1ms/)
  })
})
