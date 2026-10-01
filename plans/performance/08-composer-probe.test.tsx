// Actual composer and state owners; synthetic deferred attachment metadata at the transport seam.
import { expect, it } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AgentComposer from '../../plugins/agents/src/client/composer/AgentComposer'
import { clearComposerDrafts, composerDraftState } from '../../plugins/agents/src/client/composer/composerState'
import { setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'
import type { AgentSession } from '../../plugins/agents/src/contract/wire'

const tag = process.env.ACORN_PERF_TAG ?? 'sample'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const reply = (body: unknown) => ({ status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) })
const session = (id: string): AgentSession => ({ id, taskId: `task-${id}`, title: id, config: {}, kind: 'workflow', controller: 'acorn', runtimeState: 'ready' } as AgentSession)

it('records a deferred attachment hydrate writing into the next session through the real composer', async () => {
  localStorage.clear(); clearComposerDrafts(); setActiveNode('audit-node')
  localStorage.setItem('acorn.agent-attachments.session-a', JSON.stringify(['attachment-a']))
  let settleAttachment: ((body: unknown) => void) | undefined
  const paths: string[] = []
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {},
    nodeFetch: async (_nodeId: string, request: { path: string }) => {
      paths.push(request.path)
      if (request.path.endsWith('/attachments/attachment-a')) return new Promise(resolve => { settleAttachment = body => resolve(reply(body)) })
      return reply({})
    },
  } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const [current, setCurrent] = createSignal(session('session-a'))
  const host = document.createElement('div'); document.body.append(host)
  const stop = render(() => <QueryClientProvider client={client}><AgentComposer session={current()} onSent={() => {}} onSessionUpdated={() => {}} /></QueryClientProvider>, host)
  await tick()
  expect(settleAttachment).toBeTypeOf('function')
  setCurrent(session('session-b'))
  await tick()
  const before = { old: composerDraftState('session-a').attachments().map(item => item.id), current: composerDraftState('session-b').attachments().map(item => item.id) }
  settleAttachment!({ id: 'attachment-a', taskId: 'task-session-a', filename: 'synthetic-a.txt', mediaType: 'text/plain', byteSize: 1 })
  await tick(); await tick()
  const after = { old: composerDraftState('session-a').attachments().map(item => item.id), current: composerDraftState('session-b').attachments().map(item => item.id),
    currentStorage: localStorage.getItem('acorn.agent-attachments.session-b'), currentDOMHasOldAttachment: host.textContent?.includes('synthetic-a.txt') }
  expect(after.current).toEqual(['attachment-a']) // Explicit fail-before: must be [] after repair.
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), `08-composer-lifecycle-${tag}.json`), JSON.stringify({ fixture: 'actual AgentComposer, composerState, managedClient and API transport; non-keyed session prop change while hydration waits', paths, before, after }, null, 2) + '\n')
  stop(); host.remove(); client.clear(); clearComposerDrafts(); localStorage.clear(); setActiveNode(null); delete (window as any).acorn
})
