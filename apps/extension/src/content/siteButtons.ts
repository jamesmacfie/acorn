import type { BrowserApi } from '../browser'
import type { ButtonClick, ContentMessage } from '../handoffs'

// The handoff buttons on a website page. The background injects this into a page it may read and says
// which buttons the page gets; this script only draws them, keeps one of each through the page's own
// rerenders and client-side navigation, and reports a click. It imports types only, because the
// background injects it as one classic script file.
//
// Plugin data reaches the page as text and as selectors, never as markup or styles: the label is
// `textContent`, an anchor goes to `querySelector`, and the button's look is this file's own.

type Button = ContentMessage['buttons'][number]

const ATTRIBUTE = 'data-acorn-handoff'
// A plain look that sits in most toolbars. Fixed here, so no page or plugin value reaches a style.
const STYLE =
  'margin-left:8px;padding:3px 10px;border:1px solid #8c959f;border-radius:6px;background:#f6f8fa;color:#1f2328;font:500 12px/20px system-ui,sans-serif;cursor:pointer;'

const scope = globalThis as { browser?: BrowserApi; chrome?: BrowserApi; acornSiteButtons?: boolean }
const api = scope.browser ?? scope.chrome

// Injected again after a navigation or a new grant; the first copy already listens.
if (api && !scope.acornSiteButtons) {
  scope.acornSiteButtons = true
  let buttons: Button[] = []
  let scheduled = false

  const drawn = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[${ATTRIBUTE}]`)]

  // The first anchor that is on the page and drawn. Sites hide one header row and show another as the
  // window narrows, so a hidden match is passed over for the next selector.
  const anchorFor = (button: Button): Element | null => {
    for (const selector of button.anchors) {
      try {
        for (const found of document.querySelectorAll(selector)) if (found.checkVisibility?.() ?? true) return found
      } catch {
        // A selector this browser can't parse matches nothing.
      }
    }
    return null
  }

  const create = (button: Button): HTMLButtonElement => {
    const element = document.createElement('button')
    element.type = 'button'
    element.setAttribute(ATTRIBUTE, button.key)
    element.textContent = button.label
    element.style.cssText = STYLE
    element.addEventListener('click', (event) => {
      // Only the person's own click. A page can call `click()` on any element, and that mustn't open
      // the sidebar on its behalf.
      if (!event.isTrusted) return
      event.preventDefault()
      event.stopPropagation()
      void api.runtime.sendMessage({ type: 'acorn:handoff', key: button.key } satisfies ButtonClick)
    })
    return element
  }

  // One button per handoff, inside the first anchor that matches. A button whose handoff went away is
  // removed; a page that redrew its header gets the button back.
  const reconcile = (): void => {
    scheduled = false
    const wanted = new Set(buttons.map((button) => button.key))
    for (const element of drawn()) if (!wanted.has(element.getAttribute(ATTRIBUTE) ?? '')) element.remove()
    for (const button of buttons) {
      const anchor = anchorFor(button)
      const existing = drawn().find((element) => element.getAttribute(ATTRIBUTE) === button.key)
      if (existing && anchor?.contains(existing)) continue
      existing?.remove()
      anchor?.append(create(button))
    }
  }

  // Sites redraw their headers on navigation and on data loads. A frame's worth of changes is one pass.
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(reconcile)
  }
  const observer = new MutationObserver(schedule)
  // A resize can hide the anchor a button sits in and show another.
  addEventListener('resize', schedule)

  api.runtime.onMessage.addListener((raw) => {
    const message = raw as ContentMessage | null
    if (message?.type !== 'acorn:buttons' || !Array.isArray(message.buttons)) return
    buttons = message.buttons
    if (buttons.length) observer.observe(document.documentElement, { childList: true, subtree: true })
    else observer.disconnect()
    reconcile()
  })
}
