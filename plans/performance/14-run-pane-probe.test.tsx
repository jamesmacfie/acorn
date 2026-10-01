import { createRoot } from 'solid-js'
import { expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixture = vi.hoisted(() => ({ events: undefined as undefined | ((frame: { runId: string; stepId: string; event: unknown }) => void),
  child: undefined as undefined | ((frame: unknown) => void), reads: 0, stepReads: 0, delayed: false, registrations: 0, disposals: 0 }))
vi.mock('@acorn/plugin-api/client', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsOnWorkflowStepEvent: (callback: typeof fixture.events) => { fixture.registrations++; fixture.events = callback; return () => { fixture.disposals++; fixture.events = undefined } },
  wsOnWorkflowStepChanged: () => () => {}, wsOnReconnect: () => () => {},
  onPluginFrame: (_plugin: string, channel: string, callback: (frame: unknown) => void) => { if (channel.endsWith('child-changed')) fixture.child = callback; return () => {} },
  consumePaneIntent: () => undefined, clientEvents: { on: () => () => {} },
}))
vi.mock('../../plugins/workflows/src/client/workflowsClient', () => ({ workflowApi: {
  runs: async () => {
    fixture.reads++; if (fixture.delayed) await new Promise(resolve => setTimeout(resolve, 25))
    return Array.from({ length: 12 }, (_, i) => ({ id: `run-${i}`, taskId: 'task', status: 'done', name: `run-${i}`,
      createdAt: 12 - i, updatedAt: 12 - i, parentTaskId: null, defJson: JSON.stringify({ baseline: 'acorn-1', formatVersion: 1, name: `run-${i}`, steps: [] }) }))
  },
  steps: async (runId: string) => { fixture.stepReads++; if (fixture.delayed) await new Promise(resolve => setTimeout(resolve, 25)); return [{ id: `${runId}-step`, runId, name: 'Command', kind: 'terminal:command', status: 'done', idx: 0 }] },
} }))
const { createRunPaneModel } = await import('../../plugins/workflows/src/client/runs/runPaneModel')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

it('records event data retained across run selections and child refresh waves', async () => {
  let model!: ReturnType<typeof createRunPaneModel>, dispose!: () => void
  createRoot(off => { dispose = off; model = createRunPaneModel({ id: 'task' } as never) })
  try {
    await tick()
    expect({ event: typeof fixture.events, registrations: fixture.registrations, disposals: fixture.disposals }).toEqual({ event: 'function', registrations: 1, disposals: 0 })
    expect(model.selectedRunId()).toBe('run-0')
    const runCount = 12, eventsPerRun = 200, charsPerEvent = 2048
    for (let run = 0; run < runCount; run++) {
      const runId = `run-${run}`; model.selectRun(runId); await tick()
      expect(model.selectedRunId()).toBe(runId)
      for (let i = 0; i < eventsPerRun; i++) fixture.events?.({ runId, stepId: `${runId}-step`, event: { type: 'stdout', text: `${run}:${i}:` + 'x'.repeat(charsPerEvent) } })
    }
    const retained = Array.from({ length: runCount }, (_, run) => {
      const stepId = `run-${run}-step`, rows = model.eventsFor(stepId) as { text: string }[]
      return { stepId, events: rows.length, chars: rows.reduce((n, row) => n + row.text.length, 0), tailChars: model.tailFor(stepId).join('\n').length }
    })
    expect(retained[0].events).toBe(eventsPerRun)
    const before = { runs: fixture.reads, steps: fixture.stepReads }; fixture.delayed = true
    for (let i = 0; i < 30; i++) { fixture.child?.({ ownerTaskId: 'task', taskId: `child-${i}`, parentRunId: 'run-11' }); await tick() }
    await new Promise(resolve => setTimeout(resolve, 35))
    const refreshReads = { runs: fixture.reads - before.runs, steps: fixture.stepReads - before.steps }
    const tag = process.env.ACORN_PERF_TAG ?? 'sample', output = resolve(`plans/performance/14-run-pane-${tag}.json`)
    if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe evidence tag.')
    if (tag.startsWith('before') && existsSync(output)) throw new Error('Before evidence exists.')
    writeFileSync(output, JSON.stringify({ runCount, eventsPerRun, charsPerEvent, selectedRunId: model.selectedRunId(), retained,
      totalRetainedChars: retained.reduce((n, row) => n + row.chars, 0), childFrames: 30, refreshReads,
      expected: 'An explicit byte and ownership budget bounds nonvisible run events; refresh bursts use one current read plus at most one follow-up for intervening edges.' }, null, 2) + '\n')
  } finally { dispose() }
})
