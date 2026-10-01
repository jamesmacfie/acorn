// Actual stream -> store -> transcript/cards/markdown/kit DOM. Synthetic content, jsdom CPU only.
import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { managedAgentStore } from '../../plugins/agents/src/client/sessions/managedStore'
import AgentTranscript from '../../plugins/agents/src/client/sessions/AgentTranscript'
import AgentAttachmentCard from '../../plugins/agents/src/client/sessions/AgentAttachmentCard'
import { _resetWsClient } from '../../packages/client-core/src/infra/node/wsClient'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
import type { AgentEventRecord, AgentSessionSnapshot } from '../../plugins/agents/src/contract/wire'

const meter = vi.hoisted(() => ({ enabled: false, parseCalls: 0, parseCharacters: 0, parseMs: 0, ownerMs: {} as Record<string, { calls: number; ms: number }> }))
vi.mock('../../packages/client-core/src/kit/lib/rendering/markdown', async importOriginal => {
  const original = await importOriginal<any>()
  return { ...original, renderBlocks: (src: string, options: unknown) => {
    const started = performance.now()
    const out = original.renderBlocks(src, options)
    if (meter.enabled) { meter.parseCalls++; meter.parseCharacters += src.length; meter.parseMs += performance.now() - started }
    return out
  } }
})
vi.mock('../../plugins/agents/src/client/sessions/agentTelemetry', async importOriginal => {
  const original = await importOriginal<any>()
  return { ...original, agentTelemetry: { ...original.agentTelemetry, measure: (name: string, fn: () => unknown, ...rest: unknown[]) => {
    const started = performance.now()
    const out = original.agentTelemetry.measure(name, fn, ...rest)
    if (meter.enabled) { const value = meter.ownerMs[name] ??= { calls: 0, ms: 0 }; value.calls++; value.ms += performance.now() - started }
    return out
  } } }
})
const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const dir = dirname(fileURLToPath(import.meta.url))
const record = (name: string, value: unknown) => writeFileSync(join(dir, `08-${name}-${tag}.json`), JSON.stringify(value, null, 2) + '\n')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const reply = (body: unknown) => ({ status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) })
const event = (seq: number, text: string, messageId = `message-${seq}`, append = false): AgentEventRecord => ({
  id: `event-${seq}`, sessionId: 'render-session', turnId: 'turn', seq, schemaVersion: 1, searchText: null,
  createdAt: 1_800_000_000_000 + seq, event: { type: 'assistant_message', text, messageId, append },
})
const resetMeter = () => { meter.parseCalls = 0; meter.parseCharacters = 0; meter.parseMs = 0; meter.ownerMs = {}; meter.enabled = true }
const summary = () => ({ parseCalls: meter.parseCalls, parseCharacters: meter.parseCharacters, parseMs: meter.parseMs, ownerMs: structuredClone(meter.ownerMs) })
const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { totalMs: values.reduce((a,b) => a+b,0), medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)] } }
class TestResizeObserver { observe() {} disconnect() {} }

it('measures mounted DOM and steady stream work through production owners', async () => {
  Object.assign(globalThis, { ResizeObserver: TestResizeObserver })
  const checkpoints = []
  for (const [cards, tailCharacters] of [[40, 80], [400, 80], [2000, 80], [400, 20_000], [400, 200_000]]) {
    let receive: ((nodeId: string, frame: unknown) => void) | undefined
    const prefix = 'Synthetic paragraph with **emphasis** and `code` plus plain words.\n\n'
    const events = Array.from({ length: cards }, (_, i) => event(i + 1, i === cards - 1 ? prefix.repeat(Math.ceil(tailCharacters / prefix.length)).slice(0, tailCharacters) : prefix))
    const source = { session: { id: 'render-session', taskId: 'render-task', title: 'Synthetic render', config: {}, kind: 'interactive', runtimeState: 'ready', controller: 'acorn', subagents: [], lastEventSeq: cards, lastReadSeq: 0, updatedAt: 1, createdAt: 1, attention: 'none' }, events, requests: [], turns: [] } as unknown as AgentSessionSnapshot
    Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {}, onNodeBytes: () => () => {}, nodeSend: () => {},
      onNodeFrame: (cb: typeof receive) => { receive = cb; return () => {} }, nodeFetch: async (_node: string, request: { path: string }) => reply(request.path.includes('/sessions/') ? source : {}),
    } })
    _resetWsClient(); setActiveNode('audit-node'); managedAgentStore.clear()
    const release = managedAgentStore.activate()
    await managedAgentStore.loadSnapshot('render-session')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
    const host = document.createElement('div'); document.body.append(host)
    resetMeter()
    const started = performance.now()
    const initialCPU = process.cpuUsage()
    const stop = render(() => <QueryClientProvider client={client}><AgentTranscript taskId="render-task" snapshot={managedAgentStore.snapshots()['render-session']} onExitSubagent={() => {}} onRequestResolved={() => {}} /></QueryClientProvider>, host)
    const initialWallMs = performance.now() - started
    const initialCPUUsed = process.cpuUsage(initialCPU)
    const initial = { synchronousWallMs: initialWallMs, processCPUms: (initialCPUUsed.user + initialCPUUsed.system) / 1000, elements: host.querySelectorAll('*').length, turns: host.querySelectorAll('.ui-timeline-turn').length, markdownBlocks: host.querySelectorAll('.ui-markdown > *').length, ...summary() }
    await tick()
    const firstRow = host.querySelector('.ui-timeline-turn')
    const firstParagraph = host.querySelector('.ui-markdown p')
    const observer = new MutationObserver(() => {}); observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true })
    resetMeter()
    const durations: number[] = []
    const steadyCPU = process.cpuUsage()
    const mutations = { added: 0, removed: 0, attributes: 0, characterData: 0 }
    for (let i = 1; i <= 25; i++) {
      const begin = performance.now()
      receive!('audit-node', { channel: 'agent:event', event: event(cards + i, ' delta', `message-${cards}`, true) })
      durations.push(performance.now() - begin)
      for (const mutation of observer.takeRecords()) {
        mutations.added += mutation.addedNodes.length; mutations.removed += mutation.removedNodes.length
        if (mutation.type === 'attributes') mutations.attributes++
        if (mutation.type === 'characterData') mutations.characterData++
      }
    }
    const steadyCPUUsed = process.cpuUsage(steadyCPU)
    const steady = { synchronousWall: stats(durations), processCPUms: (steadyCPUUsed.user + steadyCPUUsed.system) / 1000, ...summary(), mutations, firstRowRetained: firstRow === host.querySelector('.ui-timeline-turn'), firstParagraphRetained: firstParagraph === host.querySelector('.ui-markdown p'),
      elements: host.querySelectorAll('*').length, rawEvents: managedAgentStore.snapshots()['render-session'].events.length }
    expect(steady.firstRowRetained).toBe(true)
    expect(steady.firstParagraphRetained).toBe(true)
    expect(steady.parseCalls).toBe(25)
    checkpoints.push({ cards, tailCharacters, initial, steady })
    meter.enabled = false; observer.disconnect(); stop(); host.remove(); client.clear(); release(); managedAgentStore.clear(); _resetWsClient()
  }
  record('transcript', { fixture: 'actual wsClient/agent channel -> managedStore -> AgentTranscript -> AgentEventCard -> Markdown/Timeline; jsdom + Solid development browser build; wrapped original telemetry/parser only counts and brackets actual production owner functions; 25 synthetic frames synchronously delivered, no visible latency', checkpoints })
  setActiveNode(null); delete (window as any).acorn
})

it('counts repeated full image reads and data URL retention through actual attachment cards', async () => {
  Object.assign(globalThis, { ResizeObserver: TestResizeObserver })
  const conversions = vi.spyOn(FileReader.prototype, 'readAsDataURL')
  const bytes = new Uint8Array(1024 * 1024)
  const requests: string[] = []
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {}, nodeFetch: async (_node: string, request: { path: string }) => {
    requests.push(request.path)
    return request.path.endsWith('/content') ? { status: 200, headers: { 'content-type': 'image/png' }, body: bytes } : reply({ id: 'same-image', taskId: 'render-task', filename: 'synthetic.png', mediaType: 'image/png', byteSize: bytes.length })
  } } })
  setActiveNode('audit-node')
  const host = document.createElement('div'); document.body.append(host)
  const started = performance.now()
  const stop = render(() => <>{Array.from({ length: 8 }, () => <AgentAttachmentCard attachmentId="same-image" />)}</>, host)
  await vi.waitFor(() => expect(host.querySelectorAll('img').length).toBe(8))
  const observed = { conversions: conversions.mock.calls.length, metadataReads: requests.filter(path => !path.endsWith('/content')).length, contentReads: requests.filter(path => path.endsWith('/content')).length,
    contentBytesRequested: requests.filter(path => path.endsWith('/content')).length * bytes.length,
    sourceAttributeCharacters: [...host.querySelectorAll('img')].reduce((total, img) => total + (img.getAttribute('src')?.length ?? 0), 0),
    elements: host.querySelectorAll('*').length, loadElapsedMs: performance.now() - started }
  expect(observed.metadataReads).toBe(process.env.ACORN_PERF_BASELINE ? 8 : 1)
  expect(observed.contentReads).toBe(process.env.ACORN_PERF_BASELINE ? 8 : 1)
  expect(observed.conversions).toBe(process.env.ACORN_PERF_BASELINE ? 8 : 1)
  conversions.mockRestore()
  record('media', { fixture: 'eight actual AgentAttachmentCard mounts for one 1MiB synthetic image; real FileReader/dataUrl/Markdown; fake Node byte transport; jsdom does not decode image pixels or issue img fetches; load elapsed includes waits and is not renderer CPU/visible latency', observed })
  stop(); host.remove(); setActiveNode(null); delete (window as any).acorn
})
