// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentMessage } from '../handoffs'

// The content script against a real DOM. The browser side is a stub: the message listener the
// background talks to, and `sendMessage` for a click.
type Listener = (message: unknown) => void
let listener: Listener | undefined
let sent: unknown[] = []

beforeEach(async () => {
  document.body.innerHTML = '<header class="item"><div class="actions"><button>Edit</button></div></header>'
  sent = []
  const scope = globalThis as Record<string, unknown>
  delete scope.acornSiteButtons
  scope.chrome = {
    runtime: {
      onMessage: { addListener: (added: Listener) => void (listener = added) },
      sendMessage: async (message: unknown) => void sent.push(message),
    },
  }
  vi.resetModules()
  await import('./siteButtons')
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome
})

const show = (buttons: ContentMessage['buttons']) =>
  listener?.({ type: 'acorn:buttons', buttons } satisfies ContentMessage)
const frame = () => new Promise((resolve) => setTimeout(resolve, 40))
const drawn = () => [...document.querySelectorAll('[data-acorn-handoff]')]

describe('site buttons in the page', () => {
  it('draws one button, as text, at the end of the first anchor that matches', () => {
    show([
      {
        key: 'tracker:item',
        label: '<img src=x onerror=alert(1)>',
        anchors: ['.missing', 'not a [selector', '.actions'],
      },
    ])
    expect(drawn()).toHaveLength(1)
    const button = drawn()[0] as HTMLButtonElement
    expect(button.parentElement?.className).toBe('actions')
    expect(button.previousElementSibling?.textContent).toBe('Edit')
    expect(button.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(document.querySelector('img')).toBeNull()
  })

  it('keeps one button through a page that redraws its header', async () => {
    show([{ key: 'tracker:item', label: 'Open in Acorn', anchors: ['.actions'] }])
    document.body.innerHTML = '<header class="item"><div class="actions"></div></header>'
    await frame()
    expect(drawn()).toHaveLength(1)
    show([{ key: 'tracker:item', label: 'Open in Acorn', anchors: ['.actions'] }])
    expect(drawn()).toHaveLength(1)
  })

  it('draws nothing without an anchor, and removes buttons it is no longer given', () => {
    show([{ key: 'tracker:item', label: 'Open in Acorn', anchors: ['.nowhere'] }])
    expect(drawn()).toHaveLength(0)
    show([{ key: 'tracker:item', label: 'Open in Acorn', anchors: ['.actions'] }])
    expect(drawn()).toHaveLength(1)
    show([])
    expect(drawn()).toHaveLength(0)
  })

  it('ignores a click the page made rather than the person', () => {
    show([{ key: 'tracker:item', label: 'Open in Acorn', anchors: ['.actions'] }])
    ;(drawn()[0] as HTMLButtonElement).click()
    expect(sent).toEqual([])
  })
})
