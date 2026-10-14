import type { BrowserApi } from '../browser'
import type { AppMarker, ButtonClick, ContentMessage } from '../handoffs'

// The task chips and the branch marker on a website page. The background injects this into a page it
// may read and says what the page gets; this script only draws it, keeps it through the page's own
// rerenders and client-side navigation, and reports a click. It imports types only, because the
// background injects it as one classic script file.
//
// Plugin data reaches the page as text and as selectors, never as markup or styles: the label, the
// task name, and the branch are `textContent`, an anchor goes to `querySelector`, and the look is this
// file's own. Each pill draws inside a closed shadow root, so the page's CSS can't restyle it and none
// of its own leaks out.

type Button = ContentMessage['buttons'][number]
type Page = Omit<ContentMessage, 'type' | 'buttons' | 'marker'>

const ATTRIBUTE = 'data-acorn-handoff'
const MARKER_ATTRIBUTE = 'data-acorn-marker'
// The host element sits in the page's own DOM, so its few styles are inline, where page rules can't win.
const HOST_STYLE = 'all:initial;display:inline-flex;vertical-align:middle;margin-left:8px;'
// The branch marker sits in the bottom-right corner, above the page.
const MARKER_HOST_STYLE = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;'
// Fixed here, so no page or plugin value reaches a style. A pill takes the page's light or dark theme,
// the chip its buttons' height, and both borrow only Acorn's mark, a monospaced name, and the state
// dot's colours from Acorn's tokens.
const CSS = `
.chip { position: relative; display: inline-flex; height: var(--height); box-sizing: border-box;
  border: 1px solid var(--line); border-radius: 6px; background: var(--fill); color: var(--text);
  font: 500 12px/1 system-ui, sans-serif; }
.chip[data-theme='light'] { --text: #242424; --fill: #f6f8fa; --line: #d0d7de; --menu: #ffffff;
  --ok: #1a7f37; --warn: #9a6700; --bad: #cf222e; }
.chip[data-theme='dark'] { --text: #dddddd; --fill: #21262d; --line: #3d444d; --menu: #161b22;
  --ok: #3fb950; --warn: #d29922; --bad: #f85149; }
.marker { --height: 28px; border-radius: 14px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2); }
button, a { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center;
  gap: 6px; padding: 0 10px; color: inherit; font: inherit; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
.main { height: 100%; }
.more { height: 100%; padding: 0 8px; border-left: 1px solid var(--line); }
.name { font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 24em; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.state { display: inline-flex; align-items: center; gap: 4px; }
.state[data-tone='warn'] { color: var(--warn); font-weight: 600; }
.state[data-tone='bad'] { color: var(--bad); font-weight: 600; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
.state[data-tone='warn'] .dot { background: var(--warn); }
.state[data-tone='bad'] .dot { background: var(--bad); }
.menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 2147483647; min-width: 220px;
  display: flex; flex-direction: column; padding: 4px 0; border: 1px solid var(--line); border-radius: 6px;
  background: var(--menu); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); }
.marker .menu { top: auto; bottom: calc(100% + 4px); }
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
  let marker: AppMarker | null = null
  let page: Page = { opensLinks: false, opensPanel: true }
  let scheduled = false
  // The pill whose menu is open, and how to close it. One menu is open at a time.
  let openMenu: { host: Element; close(): void } | null = null
  // The button each chip was drawn for, and the marker drawn. A new message brings new objects, so a
  // pill is drawn again when what it shows may have changed, and kept through the page's own redraws
  // otherwise.
  const drawnFor = new WeakMap<Element, Button>()
  let drawnMarker: { host: HTMLElement; marker: AppMarker } | null = null

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
  const darkPage = (element: Element): boolean => {
    const [red, green, blue] = (getComputedStyle(element).color.match(/[\d.]+/g) ?? []).map(Number)
    return red !== undefined && 0.299 * red + 0.587 * (green ?? 0) + 0.114 * (blue ?? 0) > 128
  }
  // The height of the site's own buttons beside the chip, or a common toolbar height.
  const buttonHeight = (anchor: Element): number =>
    anchor.querySelector(`button:not([${ATTRIBUTE}]), a`)?.getBoundingClientRect().height || 28

  const report = (message: ButtonClick) => void api.runtime.sendMessage(message)

  // Only the person's own click. A page can call `click()` on any element, and that mustn't open the
  // sidebar on its behalf. The click stays with the pill, so the page's own handlers don't see it.
  const trusted = (event: Event): boolean => {
    event.preventDefault()
    event.stopPropagation()
    return event.isTrusted
  }

  // A pill in a closed shadow root: Acorn's mark, a monospaced name, and a state dot. Constant markup
  // only; everything a plugin or the Node supplied goes in as text.
  const pill = (
    host: HTMLElement,
    theme: Element,
    name: string,
    state: { label: string; tone: string } | null,
  ): { root: ShadowRoot; chip: HTMLElement; main: HTMLButtonElement } => {
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>${CSS}</style><div class="chip"><button type="button" class="main">${MARK}<span class="name"></span></button></div>`
    const chip = root.querySelector<HTMLElement>('.chip')!
    chip.dataset.theme = darkPage(theme) ? 'dark' : 'light'
    const main = root.querySelector<HTMLButtonElement>('.main')!
    root.querySelector<HTMLElement>('.name')!.textContent = name
    if (state) {
      const element = document.createElement('span')
      element.className = 'state'
      element.dataset.tone = state.tone
      element.innerHTML = '<span class="dot"></span>'
      element.append(state.label)
      main.append(element)
    }
    return { root, chip, main }
  }

  // A pill's menu items. `close` is bound once the menu exists, so items made before it can close it.
  const menuItems = () => {
    const items: HTMLElement[] = []
    let close = () => {}
    // An item closes the menu, unless it says what it did in place.
    const add = (text: string, action: (element: HTMLElement) => void, keepOpen = false): void => {
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = text
      element.addEventListener('click', (event) => {
        if (!trusted(event)) return
        if (!keepOpen) close()
        action(element)
      })
      items.push(element)
    }
    return {
      items,
      add,
      // A plain link, which the browser hands to the desktop app.
      link(href: string): void {
        const open = document.createElement('a')
        open.href = href
        open.textContent = 'Open in Acorn ↗'
        open.addEventListener('click', () => close())
        items.push(open)
      },
      copy(href: string): void {
        add(
          'Copy Acorn link',
          (element) => {
            void navigator.clipboard.writeText(href).then(
              () => (element.textContent = 'Copied'),
              () => undefined,
            )
          },
          true,
        )
      },
      note(text: string): void {
        const note = document.createElement('p')
        note.className = 'note'
        note.textContent = text
        items.push(note)
      },
      bind(closeMenu: () => void): void {
        close = closeMenu
      },
    }
  }

  // The menu under a pill. With `split`, a ▾ beside the main button opens it, and the main button
  // keeps its own click; otherwise the main button opens it. Returns how to open it.
  const attachMenu = (
    host: Element,
    root: ShadowRoot,
    chip: HTMLElement,
    main: HTMLElement,
    items: HTMLElement[],
    split: boolean,
  ) => {
    for (const element of items) element.setAttribute('role', element.tagName === 'P' ? 'note' : 'menuitem')
    const menu = document.createElement('div')
    menu.className = 'menu'
    menu.setAttribute('role', 'menu')
    menu.append(...items)
    let toggle = main
    if (split) {
      toggle = document.createElement('button')
      toggle.setAttribute('type', 'button')
      toggle.className = 'more'
      toggle.textContent = '▾'
      toggle.setAttribute('aria-label', 'More Acorn actions')
      toggle.addEventListener('click', (event) => trusted(event) && setOpen(menu.hidden === true))
      chip.append(toggle)
    }
    toggle.setAttribute('aria-haspopup', 'menu')
    const setOpen = (open: boolean): void => {
      if (open) openMenu?.close()
      menu.hidden = !open
      toggle.setAttribute('aria-expanded', String(open))
      openMenu = open ? { host, close: () => setOpen(false) } : openMenu?.host === host ? null : openMenu
    }
    setOpen(false)
    chip.append(menu)
    root.addEventListener('keydown', (event) => (event as KeyboardEvent).key === 'Escape' && setOpen(false))
    return setOpen
  }

  const createChip = (button: Button, anchor: Element): HTMLElement => {
    const host = document.createElement('span')
    host.setAttribute(ATTRIBUTE, button.key)
    host.style.cssText = HOST_STYLE
    const task = button.task
    const { root, chip, main } = pill(host, anchor, task ? task.title : 'Start task', task?.state ?? null)
    chip.style.setProperty('--height', `${buttonHeight(anchor)}px`)
    // The plugin's label stays in the accessible name, beside what the chip shows.
    main.setAttribute('aria-label', `${main.textContent} (${button.label})`)

    // The menu: the task's verbs, or with no task the two ways to start one, as the desktop's row menu
    // offers them. In Firefox, where a page can't open the sidebar, it says how to open it.
    const menu = menuItems()
    const chipClick = (action: 'show' | 'chat') => report({ type: 'acorn:chip', key: button.key, action })
    if (task) {
      if (page.opensPanel) menu.add('Show in side panel', () => chipClick('show'))
      if (task.link && page.opensLinks) menu.link(task.link)
      if (page.opensPanel) menu.add('New chat about this page', () => chipClick('chat'))
      if (task.link) menu.copy(task.link)
      if (!page.opensPanel) menu.note('To open the panel on this task, click Acorn in the toolbar.')
    } else {
      menu.add('Create task', () => report({ type: 'acorn:handoff', key: button.key, start: 'task' }))
      menu.add('Start workflow…', () => report({ type: 'acorn:handoff', key: button.key, start: 'workflow' }))
      if (!page.opensPanel) menu.note('Then click Acorn in the toolbar to open the panel.')
    }

    // Chrome opens the panel on the task from the chip itself, with the menu on a ▾ beside it. With no
    // task, and in Firefox, the chip opens the menu, and a choice there waits in the sidebar.
    const split = task !== null && page.opensPanel
    const setOpen = attachMenu(host, root, chip, main, menu.items, split)
    menu.bind(() => setOpen(false))
    main.addEventListener('click', (event) => {
      if (!trusted(event)) return
      if (split) chipClick('show')
      else setOpen(true)
    })
    drawnFor.set(host, button)
    return host
  }

  // The branch marker: which task's app this page is, and its state, in the page's corner. A click
  // opens the panel on the task; its menu also hides it on this site.
  const createMarker = (shown: AppMarker): HTMLElement => {
    const host = document.createElement('div')
    host.setAttribute(MARKER_ATTRIBUTE, '')
    host.style.cssText = MARKER_HOST_STYLE
    const { root, chip, main } = pill(host, document.body ?? document.documentElement, shown.branch, shown.state)
    chip.classList.add('marker')
    main.setAttribute('aria-label', `${shown.branch}, ${shown.state.label} (Acorn)`)

    const menu = menuItems()
    const markerClick = (action: 'show' | 'hide') => report({ type: 'acorn:marker', action })
    if (page.opensPanel) menu.add('Show in side panel', () => markerClick('show'))
    if (shown.link && page.opensLinks) menu.link(shown.link)
    if (shown.link) menu.copy(shown.link)
    menu.add('Hide on this site', () => markerClick('hide'))
    if (!page.opensPanel) menu.note('To open the panel on this task, click Acorn in the toolbar.')
    const setOpen = attachMenu(host, root, chip, main, menu.items, page.opensPanel)
    menu.bind(() => setOpen(false))
    main.addEventListener('click', (event) => {
      if (!trusted(event)) return
      if (page.opensPanel) markerClick('show')
      else setOpen(true)
    })
    return host
  }

  // One chip per handoff, inside the first anchor that matches, and the marker in the corner. A pill
  // that went away is removed; a page that redrew its header, or itself, gets it back.
  const reconcile = (): void => {
    scheduled = false
    for (const element of drawn()) if (!buttons.includes(drawnFor.get(element)!)) element.remove()
    for (const button of buttons) {
      const anchor = anchorFor(button)
      const existing = drawn().find((element) => drawnFor.get(element) === button)
      if (existing && anchor?.contains(existing)) continue
      existing?.remove()
      if (anchor) anchor.append(createChip(button, anchor))
    }
    if (drawnMarker && (drawnMarker.marker !== marker || !drawnMarker.host.isConnected)) {
      drawnMarker.host.remove()
      drawnMarker = null
    }
    if (marker && !drawnMarker) {
      drawnMarker = { host: createMarker(marker), marker }
      document.documentElement.append(drawnMarker.host)
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
    marker = message.marker ?? null
    page = { opensLinks: message.opensLinks === true, opensPanel: message.opensPanel !== false }
    if (buttons.length || marker) observer.observe(document.documentElement, { childList: true, subtree: true })
    else observer.disconnect()
    reconcile()
  })
}
