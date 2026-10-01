import { expect, it } from 'vitest'
import { createSignal, createEffect } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/solid-query'
import { writeFileSync, realpathSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

it('uses one reactive component construction and the supplied ESM QueryClient across updates', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..') + '/'
  const client = new QueryClient()
  const [value, setValue] = createSignal('before')
  let constructions = 0
  const phases: string[] = []
  const Component = () => {
    constructions++
    expect(useQueryClient()).toBe(client)
    createEffect(() => phases.push(value()))
    return <span>{value()}</span>
  }
  const host = document.createElement('div')
  const stop = render(() => <QueryClientProvider client={client}><Component /></QueryClientProvider>, host)
  setValue('after')
  expect(host.textContent).toBe('after')
  expect(phases).toEqual(['before', 'after'])
  expect(constructions).toBe(1)
  const paths = ['unit09-probe.config.ts', 'unit09-store-probe.test.tsx', 'unit09-composer-probe.test.tsx', 'unit09-render-probe.test.tsx', 'unit09-runtime-probe.test.tsx']
  const hashes = Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(root + 'plans/performance/' + path)).digest('hex')]))
  writeFileSync(root + `plans/performance/evidence/unit09-runtime-${process.env.ACORN_PERF_TAG}.json`, JSON.stringify({
    esmEntry: realpathSync(root + 'packages/client-core/node_modules/@tanstack/solid-query/build/index.js'),
    solidRuntime: realpathSync(root + 'packages/client-core/node_modules/solid-js/dist/dev.js'),
    constructions, phases, providerIdentity: true, hashes,
  }, null, 2) + '\n')
  stop(); client.clear()
})
