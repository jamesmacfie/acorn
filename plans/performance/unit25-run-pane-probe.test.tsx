import { createComponent, createRoot } from 'solid-js'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
const fixture = vi.hoisted(() => ({
  events: undefined as undefined | ((frame: { runId: string; stepId: string; event: unknown }) => void),
  reads: 0, stepReads: 0,
}))
vi.mock('@acorn/plugin-api/client', async original => ({
  ...(await original<Record<string, unknown>>()),
  wsOnWorkflowStepEvent: (callback: typeof fixture.events) => { fixture.events = callback; return () => { fixture.events = undefined } },
  wsOnWorkflowStepChanged: () => () => {}, wsOnReconnect: () => () => {},
  onPluginFrame: () => () => {}, consumePaneIntent: () => undefined, clientEvents: { on: () => () => {} },
}))
const api = {
  runs: async () => {
    fixture.reads++
    return Array.from({ length: 12 }, (_, i) => ({ id: `run-${i}`, taskId: 'task', status: 'done', name: `run-${i}`,
      createdAt: 12 - i, updatedAt: 12 - i, parentTaskId: null,
      defJson: JSON.stringify({ baseline: 'acorn-1', formatVersion: 1, name: `run-${i}`, steps: [] }) }))
  },
  steps: async (runId: string) => {
    fixture.stepReads++
    return [{ id: `${runId}-step`, runId, name: 'Command', kind: 'terminal:command', status: 'done', idx: 0,
      resultJson: JSON.stringify({ stdout: 'canonical output', stderr: '' }) }]
  },
}
vi.mock('../../plugins/workflows/src/client/workflowsClient', () => ({ workflowApi: api, createWorkflowApi: () => api }))
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const gc = () => { for (let i = 0; i < 5; i++) (globalThis as { gc?: () => void }).gc?.() }

it('compares the same 12-run stream workload and actual retained heap at both owners', async () => {
  expect(typeof (globalThis as { gc?: () => void }).gc).toBe('function')
  const tag = process.env.ACORN_PERF_TAG ?? 'unit25-after'
  const results: unknown[] = []
  for (const phase of ['before', 'after'] as const) {
    const factory = phase === 'before'
      ? (await import('./evidence/unit25-runPaneModel-before')).createRunPaneModel
      : (await import('../../plugins/workflows/src/client/runs/runPaneModel')).createRunPaneModel
    gc()
    const baseline = process.memoryUsage().heapUsed
    const cpu = process.cpuUsage()
    let model!: ReturnType<typeof factory>, dispose!: () => void, constructions = 0
    createRoot(off => {
      dispose = off
      createComponent(QueryClientProvider, { client: new QueryClient(), get children() {
        constructions++
        model = factory({ id: 'task' } as never)
        return null
      } })
    })
    await tick()
    for (let run = 0; run < 12; run++) {
      const runId = `run-${run}`
      model.selectRun(runId); await tick()
      for (let i = 0; i < 200; i++) fixture.events?.({ runId, stepId: `${runId}-step`, event: { type: 'stdout', text: `${run}:${i}:` + 'x'.repeat(2048) } })
    }
    gc()
    const retainedHeapDelta = process.memoryUsage().heapUsed - baseline
    const retained = Array.from({ length: 12 }, (_, run) => {
      const stepId = `run-${run}-step`
      const rows = model.eventsFor(stepId) as { text: string }[]
      return { stepId, events: rows.length, chars: rows.reduce((n, row) => n + row.text.length, 0), tailChars: model.tailFor(stepId).join('\n').length }
    })
    const totalRetainedChars = retained.reduce((n, row) => n + row.chars, 0)
    expect(totalRetainedChars).toBe(phase === 'before' ? 4928680 : 0)
    expect(retained[11].tailChars).toBe(4000)
    expect(model.tailFor('run-11-step').join('\n')).toBe(('11:198:' + 'x'.repeat(2048) + '11:199:' + 'x'.repeat(2048)).slice(-4000))
    expect(constructions).toBe(1)
    model.selectRun('run-0'); await tick()
    expect(JSON.parse(model.steps()[0].resultJson!).stdout).toBe('canonical output')
    fixture.events?.({ runId: 'run-0', stepId: 'run-0-step', event: { type: 'unrecognised', text: 'kept' } })
    expect(model.eventsFor('run-0-step').at(-1)).toEqual({ type: 'unrecognised', text: 'kept' })
    for (let i = 0; i < 205; i++) fixture.events?.({ runId: 'run-0', stepId: 'overflow', event: { type: 'unrecognised', detail: i } })
    const overflowEvents = model.eventsFor('overflow') as { detail: number }[]
    expect(overflowEvents).toHaveLength(200)
    expect(overflowEvents[0].detail).toBe(5)
    const displayedOmissions = phase === 'after' ? (model as { droppedEventsFor: (id: string) => number }).droppedEventsFor('overflow') : null
    if (phase === 'after') expect(displayedOmissions).toBe(5)
    results.push({ phase, overflow: { received: 205, retained: overflowEvents.length, firstRetained: 5, displayedOmissions }, runCount: 12, eventsPerRun: 200, charsPerEvent: 2048, retained,
      totalRetainedChars, retainedHeapDelta, cpuMicroseconds: process.cpuUsage(cpu), constructions })
    dispose(); gc()
  }
  writeFileSync(`plans/performance/unit25-stream-${tag}.json`, JSON.stringify({
    environment: { node: process.version, host: 'jsdom', gc: 'five explicit collections per sample',
      note: 'One paired fixture run; heap includes model bookkeeping and allocator noise. CPU includes fixture and explicit GC. No native latency claim.' }, results,
  }, null, 2) + '\n')
})
