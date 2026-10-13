import type { BrowserApi } from '../browser'
import type { ButtonClick, ContentMessage } from '../handoffs'

// The task chips on a website page. The background injects this into a page it may read and says
// which chips the page gets; this script only draws them, keeps one of each through the page's own
// rerenders and client-side navigation, and reports a click. It imports types only, because the
// background injects it as one classic script file.
//
// Plugin data reaches the page as text and as selectors, never as markup or styles: the label and the
// task name are `textContent`, an anchor goes to `querySelector`, and the look is this file's own. Each
// chip draws inside a closed shadow root, so the page's CSS can't restyle it and none of its own leaks
// out.

type Button = ContentMessage['buttons'][number]
type Page = Omit<ContentMessage, 'type' | 'buttons'>

const ATTRIBUTE = 'data-acorn-handoff'
// The host element sits in the page's own DOM, so its few styles are inline, where page rules can't win.
const HOST_STYLE = 'all:initial;display:inline-flex;vertical-align:middle;margin-left:8px;'
// Fixed here, so no page or plugin value reaches a style. The chip takes the page's light or dark
// theme and its buttons' height, and borrows only Acorn's mark, a monospaced task name, and the
// state dot's colours from Acorn's tokens.
const CSS = `
.chip { position: relative; display: inline-flex; height: var(--height); box-sizing: border-box;
  border: 1px solid var(--line); border-radius: 6px; background: var(--fill); color: var(--text);
  font: 500 12px/1 system-ui, sans-serif; }
.chip[data-theme='light'] { --text: #242424; --fill: #f6f8fa; --line: #d0d7de; --menu: #ffffff;
  --ok: #1a7f37; --warn: #9a6700; }
.chip[data-theme='dark'] { --text: #dddddd; --fill: #21262d; --line: #3d444d; --menu: #161b22;
  --ok: #3fb950; --warn: #d29922; }
button, a { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center;
  gap: 6px; padding: 0 10px; color: inherit; font: inherit; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
.main { height: 100%; }
.more { height: 100%; padding: 0 8px; border-left: 1px solid var(--line); }
.name { font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 24em; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.state { display: inline-flex; align-items: center; gap: 4px; }
.state[data-tone='warn'] { color: var(--warn); font-weight: 600; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
.state[data-tone='warn'] .dot { background: var(--warn); }
.menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 2147483647; min-width: 220px;
  display: flex; flex-direction: column; padding: 4px 0; border: 1px solid var(--line); border-radius: 6px;
  background: var(--menu); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); }
.menu[hidden] { display: none; }
.menu > button, .menu > a { height: 32px; white-space: nowrap; }
.menu > button:hover, .menu > a:hover { background: var(--fill); }
.note { margin: 4px 10px; color: var(--text); opacity: 0.7; font: 400 12px/1.4 system-ui, sans-serif;
  white-space: normal; }
`
// Acorn's mark, as a line drawing that reads at the size of a button's icon.
const MARK =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 1.5v2M2.5 7h11c0-2.5-2.5-3.5-5.5-3.5S2.5 4.5 2.5 7zM4 7v3l4 4.5 4-4.5V7"/></svg>'

const scope = globalThis as { browser?: BrowserApi; chrome?: BrowserApi; acornSiteButtons?: boolean }
const api = scope.browser ?? scope.chrome

// Injected again after a navigation or a new grant; the first copy already listens.
if (api && !scope.acornSiteButtons) {
  scope.acornSiteButtons = true
  let buttons: Button[] = []
  let page: Page = { opensLinks: false, opensPanel: true }
  let scheduled = false
  // The chip whose menu is open, and how to close it. One menu is open at a time.
  let openMenu: { host: Element; close(): void } | null = null
  // The button each chip was drawn for. A new message brings new objects, so a chip is drawn again
  // when what it shows may have changed, and kept through the page's own redraws otherwise.
  const drawnFor = new WeakMap<Element, Button>()

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

  // Light text means a dark page.
  const darkPage = (anchor: Element): boolean => {
    const [red, green, blue] = (getComputedStyle(anchor).color.match(/[\d.]+/g) ?? []).map(Number)
    return red !== undefined && 0.299 * red + 0.587 * (green ?? 0) + 0.114 * (blue ?? 0) > 128
  }
  // The height of the site's own buttons beside the chip, or a common toolbar height.
  const buttonHeight = (anchor: Element): number =>
    anchor.querySelector(`button:not([${ATTRIBUTE}]), a`)?.getBoundingClientRect().height || 28

  const report = (message: ButtonClick) => void api.runtime.sendMessage(message)

  const create = (button: Button, anchor: Element): HTMLElement => {
    const host = document.createElement('span')
    host.setAttribute(ATTRIBUTE, button.key)
    host.style.cssText = HOST_STYLE
    const root = host.attachShadow({ mode: 'closed' })
    // Constant markup only; everything a plugin or the Node supplied goes in as text below.
    root.innerHTML = `<style>${CSS}</style><div class="chip"><button type="button" class="main">${MARK}<span class="name"></span></button></div>`
    const chip = root.querySelector<HTMLElement>('.chip')!
    chip.dataset.theme = darkPage(anchor) ? 'dark' : 'light'
    chip.style.setProperty('--height', `${buttonHeight(anchor)}px`)
    const main = root.querySelector<HTMLButtonElement>('.main')!
    const name = root.querySelector<HTMLElement>('.name')!
    const task = button.task
    name.textContent = task ? task.title : 'Start task'
    if (task?.state) {
      const state = document.createElement('span')
      state.className = 'state'
      state.dataset.tone = task.state.tone
      state.innerHTML = '<span class="dot"></span>'
      state.append(task.state.label)
      main.append(state)
    }
    // The plugin's label stays in the accessible name, beside what the chip shows.
    main.setAttribute('aria-label', `${main.textContent} (${button.label})`)

    // The menu: the task's verbs, and in Firefox, where a page can't open the sidebar, how to open it.
    const items: HTMLElement[] = []
    // An item closes the menu, unless it says what it did in place.
    const item = (text: string, action: (element: HTMLElement) => void, keepOpen = false): void => {
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = text
      element.addEventListener('click', (event) => {
        if (!trusted(event)) return
        if (!keepOpen) setOpen(false)
        action(element)
      })
      items.push(element)
    }
    const chipClick = (action: 'show' | 'chat') => report({ type: 'acorn:chip', key: button.key, action })
    if (task && page.opensPanel) item('Show in side panel', () => chipClick('show'))
    if (task?.link && page.opensLinks) {
      const open = document.createElement('a')
      open.href = task.link
      open.textContent = 'Open in Acorn ↗'
      // A plain link, which the browser hands to the desktop app.
      open.addEventListener('click', () => setOpen(false))
      items.push(open)
    }
    if (task && page.opensPanel) item('New chat about this page', () => chipClick('chat'))
    if (task?.link) {
      const link = task.link
      item(
        'Copy Acorn link',
        (element) => {
          void navigator.clipboard.writeText(link).then(
            () => (element.textContent = 'Copied'),
            () => undefined,
          )
        },
        true,
      )
    }
    if (!page.opensPanel) {
      const note = document.createElement('p')
      note.className = 'note'
      note.textContent = task
        ? 'To open the panel on this task, click Acorn in the toolbar.'
        : 'To start the task, click Acorn in the toolbar.'
      items.push(note)
    }
    for (const element of items) element.setAttribute('role', element.tagName === 'P' ? 'note' : 'menuitem')

    // Chrome opens the panel from the chip itself: on the task, or on Start task's form. Firefox opens
    // the menu, and a Start task click waits for the sidebar.
    const hasMenu = !page.opensPanel || (task !== null && items.length > 0)
    let setOpen = (_open: boolean) => {}
    if (hasMenu) {
      const menu = document.createElement('div')
      menu.className = 'menu'
      menu.setAttribute('role', 'menu')
      menu.hidden = true
      menu.append(...items)
      const toggles: HTMLElement[] = []
      setOpen = (open) => {
        if (open) openMenu?.close()
        menu.hidden = !open
        for (const toggle of toggles) toggle.setAttribute('aria-expanded', String(open))
        openMenu = open ? { host, close: () => setOpen(false) } : openMenu?.host === host ? null : openMenu
      }
      if (page.opensPanel) {
        const more = document.createElement('button')
        more.type = 'button'
        more.className = 'more'
        more.textContent = '▾'
        more.setAttribute('aria-label', 'More Acorn actions')
        more.setAttribute('aria-haspopup', 'menu')
        more.addEventListener('click', (event) => trusted(event) && setOpen(menu.hidden === true))
        toggles.push(more)
        chip.append(more)
      } else {
        main.setAttribute('aria-haspopup', 'menu')
        toggles.push(main)
      }
      setOpen(false)
      chip.append(menu)
      root.addEventListener('keydown', (event) => (event as KeyboardEvent).key === 'Escape' && setOpen(false))
    }
    main.addEventListener('click', (event) => {
      if (!trusted(event)) return
      if (!task) report({ type: 'acorn:handoff', key: button.key })
      if (page.opensPanel) {
        if (task) chipClick('show')
      } else setOpen(true)
    })
    drawnFor.set(host, button)
    return host
  }

  // Only the person's own click. A page can call `click()` on any element, and that mustn't open the
  // sidebar on its behalf. The click stays with the chip, so the page's own handlers don't see it.
  const trusted = (event: Event): boolean => {
    event.preventDefault()
    event.stopPropagation()
    return event.isTrusted
  }

  // One chip per handoff, inside the first anchor that matches. A chip whose handoff went away is
  // removed; a page that redrew its header gets the chip back.
  const reconcile = (): void => {
    scheduled = false
    for (const element of drawn()) if (!buttons.includes(drawnFor.get(element)!)) element.remove()
    for (const button of buttons) {
      const anchor = anchorFor(button)
      const existing = drawn().find((element) => drawnFor.get(element) === button)
      if (existing && anchor?.contains(existing)) continue
      existing?.remove()
      if (anchor) anchor.append(create(button, anchor))
    }
  }

  // Sites redraw their headers on navigation and on data loads. A frame's worth of changes is one pass.
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(reconcile)
  }
  const observer = new MutationObserver(schedule)
  // A click anywhere else on the page closes an open menu.
  document.addEventListener('click', (event) => {
    if (openMenu && !event.composedPath().includes(openMenu.host)) openMenu.close()
  })
  // A resize can hide the anchor a chip sits in and show another.
  addEventListener('resize', schedule)

  api.runtime.onMessage.addListener((raw) => {
    const message = raw as ContentMessage | null
    if (message?.type !== 'acorn:buttons' || !Array.isArray(message.buttons)) return
    buttons = message.buttons
    page = { opensLinks: message.opensLinks === true, opensPanel: message.opensPanel !== false }
    if (buttons.length) observer.observe(document.documentElement, { childList: true, subtree: true })
    else observer.disconnect()
    reconcile()
  })
}
