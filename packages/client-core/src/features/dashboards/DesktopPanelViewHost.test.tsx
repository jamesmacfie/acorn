import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { DashboardDisplayField } from '@acorn/dashboards-core/render'

const navigate = vi.fn()
vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }))
const createMeasureHistory = vi.fn(() => () => [])
vi.mock('./history', () => ({ createMeasureHistory }))

const { default: DesktopPanelViewHost } = await import('./DesktopPanelViewHost')
const { default: StatView } = await import('./views/StatView')
const { default: TableView } = await import('./views/TableView')
const { contentLinkRegistry } = await import('../../host/registries/panes/contentLinks')

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

const fields: DashboardDisplayField[] = [
  { id: 'title', name: 'Title', type: 'text', role: 'title' },
  { id: 'url', name: 'Link', type: 'link' },
]
const rows = [
  { id: 'one', pluginId: 'core', sourceId: 'issues', values: { title: 'Ship it', url: 'https://example.com/i/1' } },
]

// Without this provider, the views fall back silently, so this pins the desktop's link and history wiring.
it('opens a link cell in Acorn and reads a history trend from the Node', () => {
  const link = contentLinkRegistry.register({
    id: 'test.issue',
    providerId: 'issues',
    parse: (href) => (href === 'https://example.com/i/1' ? { kind: 'issue', item: '1' } : null),
    path: () => '/p/project-1/issues/1',
  })
  try {
    const host = document.body.appendChild(document.createElement('div'))
    dispose = render(
      () => (
        <DesktopPanelViewHost>
          <TableView view={{ kind: 'table' }} schema={{ fields }} fields={fields} rows={rows} />
          <StatView
            view={{ kind: 'stat', trend: 'history' }}
            panelId="panel-1"
            schema={{ fields }}
            fields={fields}
            rows={rows}
          />
        </DesktopPanelViewHost>
      ),
      host,
    )
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    host.querySelector('a.dash-cell-link')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/p/project-1/issues/1')
    expect(createMeasureHistory).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('Recording once an hour from today.')
  } finally {
    link.dispose()
  }
})
