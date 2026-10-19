import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@solidjs/router', () => ({ useNavigate: () => () => {} }))
const { default: PanelBody } = await import('./PanelBody')

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

it('draws a view kind this build does not know as an inert notice', () => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(
    () => <PanelBody view={{ kind: 'later-kind' }} schema={{ fields: [] }} fields={[]} rows={[]} />,
    host,
  )
  expect(host.textContent).toContain("Can't draw this view")
  expect(host.textContent).toContain('This version of acorn has no later-kind view.')
})
