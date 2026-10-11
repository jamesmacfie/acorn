import { expect, it, vi } from 'vitest'
import { clientEvents } from '../commands/clientEvents'
import { handlePluginContentLinkClick } from './contentLinks'

it('hands an Acorn content link to the address listener without browser navigation', () => {
  const received = vi.fn()
  const off = clientEvents.on('presentation:open-link', received)
  const anchor = document.createElement('a')
  anchor.href = 'acorn://local/settings/connections'
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  anchor.addEventListener('click', (click) => {
    handlePluginContentLinkClick(click)
  })
  anchor.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(received).toHaveBeenCalledWith({ href: 'acorn://local/settings/connections' })
  off()
})
