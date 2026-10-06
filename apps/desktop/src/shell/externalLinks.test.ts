// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { installExternalLinks } from './externalLinks'

// Vitest exposes its jsdom instance so a test can check both native and Windows-mapped origins.
declare const jsdom: { reconfigure(options: { url: string }): void }
const open = vi.fn(async (_href: string) => {})
const nativeOpen = vi.fn(() => null)
beforeAll(() => {
  window.open = nativeOpen
  installExternalLinks(window, open)
})

function page(url = 'app://acorn/t/task-1') {
  jsdom.reconfigure({ url })
  document.body.innerHTML = '<a href="https://example.com/article" target="_blank"><span>Read article</span></a>'
  open.mockClear()
  nativeOpen.mockClear()
  const click = (options: MouseEventInit = {}, type = 'click') => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options })
    document.querySelector('span')!.dispatchEvent(event)
    return event
  }
  return { window, open, nativeOpen, click }
}

describe('desktop external links', () => {
  it.each(['https://example.com/article', 'http://localhost:3000/preview', 'mailto:hello@example.com'])('hands %s to the device and cancels webview navigation', (href) => {
    const { window, open, click } = page()
    window.document.querySelector('a')!.href = href
    expect(click().defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledExactlyOnceWith(href)
  })

  it('leaves links claimed by in-app handlers inside the app', () => {
    const { window, open, click } = page()
    window.document.querySelector('a')!.addEventListener('click', (event) => event.preventDefault())
    click()
    expect(open).not.toHaveBeenCalled()
  })

  it.each([
    ['Command-click', { metaKey: true }, 'click'],
    ['Control-click', { ctrlKey: true }, 'click'],
    ['middle-click', { button: 1 }, 'auxclick'],
  ] as const)('hands a %s to the device', (_label, options, type) => {
    const { open, click } = page()
    expect(click(options, type).defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/article')
  })

  it('hands window.open browser fallbacks to the device without creating a webview', () => {
    const { window, open, nativeOpen } = page()
    expect(window.open('https://example.com/article', '_blank', 'noopener,noreferrer')).toBeNull()
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com/article')
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it.each(['app://acorn/t/task-1', 'http://app.localhost/t/task-1'])('preserves local routes on %s', (origin) => {
    const { window, open, click } = page(origin)
    window.document.querySelector('a')!.href = '/settings'
    expect(click().defaultPrevented).toBe(false)
    window.open('/settings', '_blank')
    expect(open).not.toHaveBeenCalled()
  })

  it('does not hand downloads or right clicks to the device', () => {
    const { window, open, click } = page()
    expect(click({ button: 2 }, 'auxclick').defaultPrevented).toBe(false)
    window.document.querySelector('a')!.setAttribute('download', 'article.html')
    expect(click().defaultPrevented).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
