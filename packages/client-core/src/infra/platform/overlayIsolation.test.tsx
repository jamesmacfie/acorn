import { afterEach, expect, it } from 'vitest'
import { isolateModal, modalInteractionRoot, releaseModalIsolation } from './overlayIsolation'

afterEach(() => { releaseModalIsolation(); document.body.innerHTML = '' })

it('keeps the top dialog accessible and restores background attributes on dismissal', () => {
  document.body.innerHTML = '<main aria-hidden="false"></main><div><div class="overlay-backdrop"><section role="dialog"></section></div></div>'
  const main = document.querySelector('main')!
  const backdrop = document.querySelector<HTMLElement>('.overlay-backdrop')!
  isolateModal([backdrop])
  expect(main.inert).toBe(true)
  expect(main.getAttribute('aria-hidden')).toBe('true')
  expect(backdrop.parentElement!.inert).not.toBe(true)
  isolateModal([])
  expect(main.inert).not.toBe(true)
  expect(main.getAttribute('aria-hidden')).toBe('false')
})

it('recognizes a reference panel beside its backdrop as the modal interaction', () => {
  document.body.innerHTML = '<div><div class="integrations-panel-backdrop"></div><aside class="integrations-panel"><div id="page"></div></aside></div>'
  const backdrop = document.querySelector<HTMLElement>('.integrations-panel-backdrop')!
  expect(modalInteractionRoot(backdrop)).toBe(document.querySelector('aside'))
  expect(modalInteractionRoot(backdrop).contains(document.getElementById('page'))).toBe(true)
  isolateModal([backdrop])
  expect(document.querySelector('aside')!.parentElement!.inert).not.toBe(true)
})
