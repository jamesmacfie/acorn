import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { panelGuideExamples } from '@acorn/dashboards-core/panelGuide.ts'

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
const run = vi.fn(() => new Promise(() => {}))
vi.mock('./dashboardClient', () => ({
  dashboardClient: () => ({ run, published: () => Promise.reject(new Error('no published revision')) }),
  publishedDashboardPanelKey: () => ['published-dashboard-panel'],
}))

const { default: PublishedDashboardPanel } = await import('./PublishedDashboardPanel')

let dispose: (() => void) | undefined
afterEach(() => dispose?.())

// An agent's card has a plan and no publication, so nothing may read the publication's id.
it('runs an unpublished plan as a draft, without a publication', () => {
  const plan = panelGuideExamples('ws-1')[0]!.plan
  const host = document.body.appendChild(document.createElement('div'))
  dispose = render(
    () => (
      <QueryClientProvider client={new QueryClient()}>
        <PublishedDashboardPanel
          definition={{ id: 'panel-1', title: 'By author', shaping: {}, view: plan.view }}
          workspaceId="ws-1"
          plan={plan}
        />
      </QueryClientProvider>
    ),
    host,
  )
  expect(host.querySelector('h3')?.textContent).toBe('By author')
  expect(run).toHaveBeenCalledWith({ kind: 'draft', content: plan }, 'execution', expect.any(String), expect.anything())
})
