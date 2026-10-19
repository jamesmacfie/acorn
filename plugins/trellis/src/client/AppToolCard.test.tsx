import { render } from 'solid-js/web'
import { For } from 'solid-js'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSummary } from '../shared/api'

const mocks = vi.hoisted(() => ({ summary: undefined as unknown as AppSummary, writeJson: vi.fn() }))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'n',
  allProjects: () => [{ id: 'p', workspaceId: 'w' }],
  taskById: () => ({ projectId: 'p' }),
  readJson: async (url: string) => (url.includes('/revisions/') ? { program: '', plans: {} } : mocks.summary),
  writeJson: mocks.writeJson,
}))
vi.mock('./AppView', () => ({
  default: (props: { files: unknown; readOnly: boolean }) => <p>{props.readOnly ? 'read only' : 'interactive'}</p>,
}))
import AppToolCard from './AppToolCard'

const appId = 'app-0123456789ab'
const revisions = [
  { revision: 1, note: 'First version.' },
  { revision: 2, note: 'Added owners.' },
  { revision: 3, note: 'Added a filter.' },
]
const call = (revision: number, status: 'completed' | 'running' = 'completed', output?: string) => ({
  id: `call-${revision}`,
  name: 'app_show',
  title: 'app_show',
  status,
  input: JSON.stringify({ appId, note: revisions[revision - 1]?.note ?? 'x' }),
  output: output ?? JSON.stringify({ appId, name: 'Checklist', revision }),
})

let host: HTMLDivElement, dispose: () => void
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
afterEach(() => {
  dispose?.()
  host?.remove()
  vi.clearAllMocks()
})
function draw(tools: ReturnType<typeof call>[]) {
  host = document.createElement('div')
  document.body.append(host)
  const client = new QueryClient()
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <For each={tools}>
          {(tool) => (
            <section>
              <AppToolCard tool={tool} taskId="task" defaultOpen />
            </section>
          )}
        </For>
      </QueryClientProvider>
    ),
    host,
  )
}
const cards = () => [...host.querySelectorAll('section')].map((card) => card.textContent)
const button = (card: number, text: string) =>
  [...host.querySelectorAll('section')[card]!.querySelectorAll('button')].find((b) => b.textContent === text)!

describe('app cards', () => {
  it('makes only the newest card interactive, collapses the rest, and shows an old one read only', async () => {
    mocks.summary = { appId, taskId: 'task', name: 'Checklist', head: 3, revisions }
    draw([call(1), call(2), call(3)])
    await settle()
    await settle()
    expect(cards()).toEqual([
      'v1: First version. Replaced by v3.Show v1Restore v1',
      'v2: Added owners. Replaced by v3.Show v2Restore v2',
      'Checklist · v3interactive',
    ])
    button(0, 'Show v1').click()
    await settle()
    await settle()
    expect(cards()[0]).toContain('read only')
  })

  it('restores an old revision as the next one, drawn on the card that asked', async () => {
    mocks.summary = { appId, taskId: 'task', name: 'Checklist', head: 3, revisions }
    mocks.writeJson.mockImplementation(async () => {
      mocks.summary = {
        ...mocks.summary,
        head: 4,
        revisions: [...revisions, { revision: 4, note: 'Restored v1.', restoredFrom: 1 }],
      }
      return { revision: 4 }
    })
    draw([call(1), call(2), call(3)])
    await settle()
    await settle()
    button(0, 'Restore v1').click()
    await settle()
    await settle()
    expect(mocks.writeJson).toHaveBeenCalledWith(
      `/v1/p/trellis/apps/${appId}/restore`,
      expect.objectContaining({ body: '{"revision":1}' }),
    )
    expect(cards()).toEqual([
      'Checklist · v4, restored from v1interactive',
      'v2: Added owners. Replaced by v4.Show v2Restore v2',
      'v3: Added a filter. Replaced by v4.Show v3Restore v3',
    ])
  })

  it("draws nothing for a call that didn't pass its checks", () => {
    mocks.summary = { appId, taskId: 'task', name: 'Checklist', head: 0, revisions: [] }
    draw([call(1, 'completed', '{"status":"api-error","detail":"400 unknown-component /program/root"}')])
    expect(cards()[0]).toContain("This app didn't pass its checks, so nothing was drawn.")
    expect(cards()[0]).not.toContain('interactive')
  })
})
