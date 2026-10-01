import { expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AgentComposer from '../../plugins/agents/src/client/composer/AgentComposer'
import { clearComposerDrafts } from '../../plugins/agents/src/client/composer/composerState'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
import type { AgentSession } from '../../plugins/agents/src/contract/wire'

it('measures draft edit persistence with a retained 128 KiB context across two surfaces', async () => {
  localStorage.clear(); clearComposerDrafts(); setActiveNode('draft-cost-node')
  localStorage.setItem('acorn.agent-context.draft-cost', JSON.stringify([{ type: 'context', contextId: 'cost', source: 'synthetic', content: 'x'.repeat(128 * 1024) }]))
  const client = new QueryClient()
  const session = { id: 'draft-cost', taskId: 'task', kind: 'workflow', config: {}, runtimeState: 'ready', controller: 'acorn' } as AgentSession
  const host = document.createElement('div'); document.body.append(host)
  const stop = render(() => <QueryClientProvider client={client}><AgentComposer session={session} onSent={() => {}} onSessionUpdated={() => {}} /><AgentComposer session={session} onSent={() => {}} onSessionUpdated={() => {}} /></QueryClientProvider>, host)
  await new Promise(resolve => setTimeout(resolve, 0))
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message agent"]')!
  const cpuBefore = process.cpuUsage()
  const started = performance.now()
  for (let index = 0; index < 100; index++) {
    field.value = `Synthetic edit ${index}`
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const synchronousWallMs = performance.now() - started
  const cpu = process.cpuUsage(cpuBefore)
  expect([...host.querySelectorAll('textarea')].every(item => item.value === 'Synthetic edit 99')).toBe(true)
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), `09-draft-cost-${process.env.ACORN_PERF_TAG}.json`), JSON.stringify({
    fixture: '100 actual textarea input events with two composer surfaces, one synthetic 128 KiB context; jsdom and localStorage, synchronous bracket includes input rendering and persistence',
    edits: 100, contextBytes: 128 * 1024, storageWrites: setItem.mock.calls.length,
    storedCharactersWritten: setItem.mock.calls.reduce((total, [, value]) => total + value.length, 0),
    synchronousWallMs, processCPUms: (cpu.user + cpu.system) / 1000,
  }, null, 2) + '\n')
  setItem.mockRestore(); stop(); host.remove(); client.clear(); clearComposerDrafts(); localStorage.clear(); setActiveNode(null)
})
