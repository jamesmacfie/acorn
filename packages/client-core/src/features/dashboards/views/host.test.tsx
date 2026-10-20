import type { JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { DashboardDisplayField } from '@acorn/dashboards-core/render'
import { PanelViewHostContext, type PanelViewHost } from './host'
import StatView from './StatView'
import TableView from './TableView'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

const fields: DashboardDisplayField[] = [
  { id: 'title', name: 'Title', type: 'text', role: 'title' },
  { id: 'url', name: 'Link', type: 'link' },
]
const row = (url: string) => ({ id: url, pluginId: 'core', sourceId: 'issues', values: { title: 'Ship it', url } })

/** Draws `view` under `viewHost`, or under no provider at all. */
const draw = (view: () => JSX.Element, viewHost?: PanelViewHost): HTMLElement => {
  const host = document.body.appendChild(document.createElement('div'))
  dispose = render(
    () =>
      viewHost ? <PanelViewHostContext.Provider value={viewHost}>{view()}</PanelViewHostContext.Provider> : view(),
    host,
  )
  return host
}
const table = (url: string) => () => (
  <TableView view={{ kind: 'table' }} schema={{ fields }} fields={fields} rows={[row(url)]} />
)
const click = (link: Element): boolean =>
  !link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))

it('draws a link cell as a plain link without a host, and an address that is not https as text', () => {
  const host = draw(table('https://example.com/issues/1'))
  const link = host.querySelector('a.dash-cell-link')!
  expect(link.getAttribute('href')).toBe('https://example.com/issues/1')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  dispose?.()

  const plain = draw(table('javascript:alert(1)'))
  expect(plain.querySelector('a')).toBeNull()
  expect(plain.textContent).toContain('javascript:alert(1)')
})

it("opens a link cell through the host's openLink, and leaves the click to the browser when it declines", () => {
  const openLink = vi.fn((url: string) => url.endsWith('/1'))
  const host = draw(table('https://example.com/issues/1'), { openLink })
  expect(click(host.querySelector('a.dash-cell-link')!)).toBe(true)
  expect(openLink).toHaveBeenCalledWith('https://example.com/issues/1')
  dispose?.()

  const declined = draw(table('https://example.com/issues/2'), { openLink })
  // A modified click is the browser's, so the host isn't asked.
  declined
    .querySelector('a.dash-cell-link')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true }))
  expect(openLink).toHaveBeenCalledTimes(1)
  expect(click(declined.querySelector('a.dash-cell-link')!)).toBe(false)
  expect(openLink).toHaveBeenLastCalledWith('https://example.com/issues/2')
})

const stat = () => (
  <StatView
    view={{ kind: 'stat', trend: 'history' }}
    panelId="panel-1"
    schema={{ fields }}
    fields={fields}
    rows={[row('https://example.com/issues/1')]}
  />
)

it('draws a history stat with no trend line and no recording note without a host', () => {
  const host = draw(stat)
  expect(host.querySelector('.dash-stat-value')?.textContent).toBe('1')
  expect(host.querySelector('.dash-stat-spark')).toBeNull()
  expect(host.textContent).not.toContain('Recording')
})

it("draws a history stat's trend from the host's measureHistory", () => {
  const measureHistory = vi.fn<NonNullable<PanelViewHost['measureHistory']>>(() => () => [
    { bucket: Date.now(), value: 4 },
  ])
  const host = draw(stat, { measureHistory })
  expect(host.querySelector('.dash-stat-spark')).not.toBeNull()
  const [panelId, enabled] = measureHistory.mock.calls[0]!
  expect([panelId(), enabled()]).toEqual(['panel-1', true])
})
