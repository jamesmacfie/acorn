import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/solid-query'
import { expect, it } from 'vitest'
import { writeFileSync } from 'node:fs'
it('owns a normal ESM query provider with one reactive component construction', () => {
  const client = new QueryClient(), [value, setValue] = createSignal('before')
  let constructions = 0, captured: QueryClient | undefined
  function Consumer() { constructions++; captured = useQueryClient(); return <span>{value()}</span> }
  const host = document.createElement('div'); document.body.append(host)
  const dispose = render(() => <QueryClientProvider client={client}><Consumer /></QueryClientProvider>, host)
  expect(captured).toBe(client); expect(host.textContent).toBe('before')
  setValue('after'); expect(host.textContent).toBe('after'); expect(constructions).toBe(1)
  writeFileSync(`plans/performance/evidence/unit08-provider-${process.env.ACORN_PERF_TAG ?? 'sample'}.json`, JSON.stringify({
    fixture: 'Normal QueryClientProvider and useQueryClient with one reactive Solid component', sameClient: captured === client,
    constructions, updatedText: host.textContent,
  }, null, 2) + '\n', { flag: 'wx' })
  dispose(); host.remove(); client.clear()
})
