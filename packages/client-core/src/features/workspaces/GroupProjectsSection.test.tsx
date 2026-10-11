import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prefsKey, projectsKey } from '@acorn/protocol/api.ts'
import { setActiveNode } from '../../infra/node/activeNode'
import { createWorkspacesMode } from './workspacesMode'
import { workspaceWords } from './words'
import { GroupProjectsSection } from './GroupProjectsSection'

let host: HTMLDivElement
let client: QueryClient
let dispose: () => void

beforeEach(() => {
  setActiveNode(null)
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(prefsKey, { 'core.workspaces': 'off', unrelated: 'kept' })
  client.setQueryData(projectsKey, [])
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        {(() => {
          const mode = createWorkspacesMode()
          return (
            <>
              <output>{workspaceWords(mode()).capitalizedPlural}</output>
              <GroupProjectsSection />
            </>
          )
        })()}
      </QueryClientProvider>
    ),
    host,
  )
})
afterEach(() => {
  dispose()
  host.remove()
  client.clear()
  vi.unstubAllGlobals()
})

const button = () => host.querySelector('button')!

it('requires confirmation, disables the pending write, and changes wording only after success', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(
    (_path: string, _request: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  vi.stubGlobal('fetch', fetch)
  button().click()
  expect(fetch).not.toHaveBeenCalled()
  expect(button().textContent).toBe("Group projects? This can't be undone.")
  button().click()
  expect(button().disabled).toBe(true)
  expect(host.querySelector('output')!.textContent).toBe('Projects')
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
  const [path, request] = fetch.mock.calls[0]!
  expect(path).toBe('/v1/core/prefs')
  expect(request.method).toBe('PUT')
  expect(JSON.parse(new TextDecoder().decode(request.body as Uint8Array))).toEqual({
    key: 'core.workspaces',
    value: 'on',
  })
  button().click()
  expect(fetch).toHaveBeenCalledOnce()
  finish(new Response(JSON.stringify({ key: 'core.workspaces', value: 'on' })))
  await vi.waitFor(() => expect(host.querySelector('output')!.textContent).toBe('Workspaces'))
  expect(client.getQueryData(prefsKey)).toEqual({ 'core.workspaces': 'on', unrelated: 'kept' })
})

it('shows the Node message after failure and requires confirmation again to retry', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code: 'write_failed', message: 'Could not save grouping.' } }), {
        status: 500,
      }),
  )
  vi.stubGlobal('fetch', fetch)
  button().click()
  button().click()
  await vi.waitFor(() => expect(host.textContent).toContain('Could not save grouping.'))
  expect(button().disabled).toBe(false)
  expect(button().textContent).toBe('Group projects')
  expect(host.querySelector('output')!.textContent).toBe('Projects')
  button().click()
  expect(fetch).toHaveBeenCalledOnce()
  expect(button().textContent).toBe("Group projects? This can't be undone.")
})
