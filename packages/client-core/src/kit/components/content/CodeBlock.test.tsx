import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { CodeBlock } from './CodeBlock'

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.replaceChildren()
})

const mount = (view: () => ReturnType<typeof CodeBlock>) => {
  const host = document.createElement('div')
  document.body.append(host)
  dispose = render(view, host)
  return host
}

it('draws terminal colour and never shows the escape codes', async () => {
  const [text, setText] = createSignal('\x1b(B\x1b[m\x1b[34mdesktop\x1b[0m web')
  const host = mount(() => <CodeBlock ansi>{text()}</CodeBlock>)
  // Before the highlighter loads: the stripped text, not the raw codes.
  expect(host.textContent).toBe('desktop web')

  await vi.waitFor(() => expect(host.querySelector('[data-fg]')).not.toBeNull(), { timeout: 10_000 })
  const blue = host.querySelector<HTMLElement>('[data-fg]')!
  expect(blue.textContent).toBe('desktop')
  expect(blue.style.getPropertyValue('--l')).not.toBe('')
  expect(blue.style.getPropertyValue('--r')).not.toBe('')
  expect(host.textContent).toBe('desktop web')

  // Output that grows shows plain until its own colouring is ready, never the older one.
  setText('\x1b[34mdesktop\x1b[0m web\n\x1b[1mmore\x1b[0m')
  expect(host.textContent).toBe('desktop web\nmore')
  await vi.waitFor(() => expect(host.querySelector<HTMLElement>('span[style*="bold"]')?.textContent).toBe('more'), { timeout: 10_000 })
})

it('leaves text alone without the ansi prop', () => {
  const host = mount(() => <CodeBlock>{'\x1b[34mraw'}</CodeBlock>)
  expect(host.textContent).toBe('\x1b[34mraw')
})
