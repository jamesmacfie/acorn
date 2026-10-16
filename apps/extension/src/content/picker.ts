import type { BrowserApi } from '../browser'
import type { AskMessage, AskOpened, AskSent, PickerMessage } from '../handoffs'

// The element picker on a task's page. The background injects it beside the task chip's script, or
// on its own after a right-click, and tells it what to pick: the element the person last
// right-clicked, or one they point at and click. A picked element gets the box, where the person asks
// Acorn about it. It imports types only, because the background injects it as one classic script
// file, and it draws in a closed shadow root, so the page's CSS can't restyle it.
//
// It acts only on the person's own clicks and keys. A page can make any event but a trusted one. On
// Send, it hands the background the question and a cleaned copy of the element, and the background
// asks the task's agent.

type Mode = PickerMessage['mode']

// Covers the viewport without taking the pointer, so the outline never hides what it outlines. The
// box takes the pointer back.
const HOST_STYLE = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
// The box takes the page's light or dark theme, with the task chip's colours.
const STYLES = `
.outline { position: fixed; box-sizing: border-box; border: 2px solid #2f81f7; border-radius: 3px;
  background: rgba(47, 129, 247, 0.12); }
.box { position: fixed; pointer-events: auto; box-sizing: border-box; width: 340px; max-width: calc(100vw - 16px);
  display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--line);
  border-radius: 8px; background: var(--menu); color: var(--text); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  font: 400 13px/1.4 system-ui, sans-serif; }
.box[data-theme='light'] { --text: #242424; --fill: #f6f8fa; --line: #d0d7de; --menu: #ffffff; }
.box[data-theme='dark'] { --text: #dddddd; --fill: #21262d; --line: #3d444d; --menu: #161b22; }
textarea, button { box-sizing: border-box; margin: 0; border: 1px solid var(--line); border-radius: 6px;
  background: var(--fill); color: inherit; font: inherit; }
textarea { min-height: 64px; padding: 6px 8px; resize: vertical; }
button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
svg { flex: none; }
.element { display: flex; align-items: center; gap: 6px; opacity: 0.7;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
.icon { display: contents; }
.element span, .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { position: relative; display: flex; align-items: center; gap: 6px; }
.to { min-width: 0; max-width: 100%; font-size: 12px; }
.cancel { margin-left: auto; padding: 0 4px; border-color: transparent; background: none; opacity: 0.6;
  font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.send { border-color: #2f81f7; background: #2f81f7; color: #ffffff; font-weight: 600; }
.menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 1; min-width: 220px; max-width: 100%;
  max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; padding: 4px 0;
  border: 1px solid var(--line); border-radius: 6px; background: var(--menu); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2); }
.menu.up { top: auto; bottom: calc(100% + 4px); }
.menu[hidden], .to[hidden] { display: none; }
.menu button { flex: none; height: 30px; border: 0; border-radius: 0; background: none; }
.menu button:hover, .menu [aria-checked='true'] { background: var(--fill); }
.group { padding: 6px 10px 2px; opacity: 0.6; font-size: 11px; }
.sep { height: 1px; margin: 4px 0; background: var(--line); }
.note { margin: 0; }
:focus-visible { outline: 2px solid #2f81f7; outline-offset: 1px; }
`
// The box's icons, from the kit's Lucide set, inline because this script can't import the registry.
const lucide = (shapes: string): string =>
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes}</svg>`
const BUBBLE =
  '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>'
const ICONS = {
  crosshair: lucide('<circle cx="12" cy="12" r="10"/><path d="M22 12h-4M6 12H2M12 6V2M12 22v-4"/>'),
  plus: lucide('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  'message-square': lucide(BUBBLE),
  'message-square-plus': lucide(`${BUBBLE}<path d="M12 8v6"/><path d="M9 11h6"/>`),
  'chevron-down': lucide('<path d="m6 9 6 6 6-6"/>'),
}
// The box's space from the element and from the viewport's edges, in CSS pixels.
const GAP = 8
// What the box says when the background has no screenshot of the element.
const NO_SCREENSHOT = "This goes without a screenshot: the browser didn't allow one here."
// How long Firefox's box stays to say where the reply is, in milliseconds.
const SENT_NOTE_MS = 4000
// The most of the element's HTML that goes to the agent. The background checks the same limit.
const MAX_HTML_BYTES = 50 * 1024
const TRUNCATION_ROOM = 100
// What never helps an agent find the element, and what could carry a secret or a lot of bytes.
const DROPPED_ELEMENTS = 'script, style, noscript, template, link, meta, input[type=hidden]'
const URL_ATTRIBUTES = new Set(['src', 'href', 'srcset', 'poster'])

// The element's HTML for the agent: a copy without scripts, field values, event handlers, or inline
// data, in one line of at most 50 KiB. The copy lives in a document of its own, which loads and runs
// nothing. `outerHTML` never carries what the person typed into a field, only the page's `value`
// attributes, which go too.
function cleanHtml(element: Element): string {
  const copy = document.implementation.createHTMLDocument('').importNode(element, true)
  for (const dropped of copy.querySelectorAll(DROPPED_ELEMENTS)) dropped.remove()
  for (const node of [copy, ...copy.querySelectorAll('*')])
    for (const name of node.getAttributeNames())
      if (name === 'value' || name === 'srcdoc' || name.startsWith('on')) node.removeAttribute(name)
      else if (URL_ATTRIBUTES.has(name) && /(^|[\s,])(data|blob):/i.test(node.getAttribute(name)!))
        node.setAttribute(name, '[data URL]')
  const bytes = new TextEncoder().encode(copy.outerHTML.replace(/\s+/g, ' ').trim())
  if (bytes.byteLength <= MAX_HTML_BYTES) return new TextDecoder().decode(bytes)
  const kept = MAX_HTML_BYTES - TRUNCATION_ROOM
  const more = Math.ceil((bytes.byteLength - kept) / 1024)
  return `${new TextDecoder().decode(bytes.subarray(0, kept))}<!-- truncated by Acorn: ${more} KiB more -->`
}

// What the box calls the element: its tag, with its `id` or its first class.
const elementName = (element: Element): string =>
  element.localName + (element.id ? `#${element.id}` : element.classList[0] ? `.${element.classList[0]}` : '')

// The shortest selector that matches only this element: its `id`, else its `data-testid`, else
// `nth-of-type` steps up to the nearest ancestor with a unique `id`, or to `body`.
function cssPath(element: Element): string {
  const only = (selector: string) => document.querySelectorAll(selector).length === 1
  const testId = element.getAttribute('data-testid')
  const byTestId = testId && `[data-testid="${CSS.escape(testId)}"]`
  const steps: string[] = []
  for (let node: Element | null = element; node; node = node.parentElement) {
    const id = node.id && `#${CSS.escape(node.id)}`
    if (id && only(id)) return [id, ...steps].join(' > ')
    if (node === element && byTestId && only(byTestId)) return byTestId
    if (node === document.body || !node.parentElement) return [node.localName, ...steps].join(' > ')
    const tag = node.localName
    const index = [...node.parentElement.children].filter((sibling) => sibling.localName === tag).indexOf(node)
    steps.unshift(`${tag}:nth-of-type(${index + 1})`)
  }
  return steps.join(' > ')
}

const scope = globalThis as { browser?: BrowserApi; chrome?: BrowserApi; acornPicker?: (mode: Mode) => void }
const api = scope.browser ?? scope.chrome

// Injected again after a navigation or a new grant; the first copy already listens. The chip's
// script shares this global, and starts the picker through it.
if (api && !scope.acornPicker) {
  const host = document.createElement('div')
  host.setAttribute('data-acorn-picker', '')
  host.style.cssText = HOST_STYLE
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `<style>${STYLES}</style><div class="outline" hidden></div>`
  const outline = root.querySelector<HTMLElement>('.outline')!

  let rightClicked: Element | null = null
  // While the person points: the element under the pointer. While the box is open: the element it
  // asks about.
  let target: Element | null = null
  let hovering = false
  let box: HTMLElement | null = null
  // The background's name for the open box, once it answers.
  let pickId: string | null = null
  // Closes the box's To menu, and says whether it was open. Escape and a pick put focus back on To; a
  // click elsewhere leaves it where the click put it.
  let closeMenu: (refocus?: boolean) => boolean = () => false

  const message = (sent: AskMessage): Promise<unknown> => api.runtime.sendMessage(sent).catch(() => undefined)
  const cancel = (id: string) => void message({ type: 'acorn:ask.cancel', pickId: id })

  // Light text means a dark page, as for the task chip.
  const darkPage = (element: Element): boolean => {
    const [red, green, blue] = (getComputedStyle(element).color.match(/[\d.]+/g) ?? []).map(Number)
    return red !== undefined && 0.299 * red + 0.587 * (green ?? 0) + 0.114 * (blue ?? 0) > 128
  }
  const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

  // The outline over the target, or the box below it, above it when there's no room, in the viewport.
  const place = (): void => {
    if (!target) return
    const rect = target.getBoundingClientRect()
    if (hovering) {
      outline.style.left = `${rect.left}px`
      outline.style.top = `${rect.top}px`
      outline.style.width = `${rect.width}px`
      outline.style.height = `${rect.height}px`
    }
    if (!box) return
    const { width, height } = box.getBoundingClientRect()
    const below = rect.bottom + GAP
    const top = below + height <= innerHeight - GAP ? below : rect.top - GAP - height
    box.style.left = `${clamp(rect.left, GAP, innerWidth - width - GAP)}px`
    box.style.top = `${clamp(top, GAP, innerHeight - height - GAP)}px`
  }

  // The element the box asks about left the page, as on a client-side navigation.
  const observer = new MutationObserver(() => target?.isConnected === false && stop())

  // Nothing on screen. A box that closes sends nothing, and the background forgets it.
  const stop = (): void => {
    if (pickId) cancel(pickId)
    pickId = null
    closeMenu = () => false
    hovering = false
    target = null
    outline.hidden = true
    box?.remove()
    box = null
    observer.disconnect()
    host.remove()
    host.style.visibility = ''
  }

  const hover = (): void => {
    stop()
    hovering = true
    document.documentElement.append(host)
  }

  // The person's own click on Cancel. The click stays in the box, so the page's handlers don't see it.
  const cancelled = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
    if (event.isTrusted) stop()
  }

  const ask = (element: Element): void => {
    stop()
    target = element
    box = document.createElement('div')
    box.className = 'box'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'Ask Acorn about this element')
    box.dataset.theme = darkPage(document.body ?? document.documentElement) ? 'dark' : 'light'
    box.innerHTML =
      `<div class="element">${ICONS.crosshair}<span></span></div>` +
      '<textarea aria-label="Question" placeholder="Ask about this element" rows="3" maxlength="20000"></textarea>' +
      `<div class="bar"><button type="button" class="to" aria-haspopup="menu" aria-expanded="false" disabled hidden><span class="icon"></span><span class="label"></span>${ICONS['chevron-down']}</button>` +
      '<div class="menu" role="menu" aria-label="To" hidden></div>' +
      '<button type="button" class="cancel" aria-label="Cancel">esc</button>' +
      '<button type="button" class="send" disabled>Send <span aria-hidden="true">↵</span></button></div>' +
      '<p class="note" role="status" hidden></p>'
    const { width: shownWidth, height: shownHeight } = element.getBoundingClientRect()
    box.querySelector('.element span')!.textContent =
      `${elementName(element)} · ${Math.round(shownWidth)} × ${Math.round(shownHeight)}`
    box.querySelector('.cancel')!.addEventListener('click', cancelled)
    const opened = box
    const question = box.querySelector('textarea')!
    const to = box.querySelector<HTMLButtonElement>('.to')!
    const menu = box.querySelector<HTMLElement>('.menu')!
    const send = box.querySelector<HTMLButtonElement>('.send')!
    const note = box.querySelector<HTMLElement>('.note')!
    // Where the question goes: a conversation, or a new chat with an agent row, and what To calls it.
    // Null until the background answers, and when no agent can start and the task has no conversation.
    type Destination = { sessionId: string | null; agent: string | null; label: string }
    let destination: Destination | null = null
    const rows: { button: HTMLButtonElement; choice: Destination }[] = []
    let ready = false
    let sending = false
    const say = (line: string | null): void => {
      note.textContent = line
      note.hidden = !line
      place()
    }
    const update = (): void => {
      send.disabled = !ready || sending || !question.value.trim() || !destination
    }
    // To shows the destination. Names are the Node's, so they go in as text.
    const showTo = (icon: keyof typeof ICONS, label: string): void => {
      to.querySelector('.icon')!.innerHTML = ICONS[icon]
      to.querySelector('.label')!.textContent = label
      to.setAttribute('aria-label', `To: ${label}`)
    }
    const choose = (choice: Destination): void => {
      destination = choice
      showTo(choice.agent ? 'message-square-plus' : 'message-square', choice.label)
      for (const row of rows) row.button.setAttribute('aria-checked', String(row.choice === choice))
      update()
    }
    const setMenu = (open: boolean): void => {
      menu.hidden = !open
      to.setAttribute('aria-expanded', String(open))
      if (!open) return
      // Above the bar when the box sits too low for the menu to fit under it.
      menu.classList.toggle('up', to.getBoundingClientRect().bottom + menu.offsetHeight + GAP > innerHeight)
      menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    }
    closeMenu = (refocus = false) => {
      if (menu.hidden) return false
      setMenu(false)
      if (refocus) to.focus()
      return true
    }
    // The person's own click on To or a row. The click stays here, so the box and the page, which
    // close the menu on any other click, don't see it.
    const own = (event: Event): boolean => {
      event.preventDefault()
      event.stopPropagation()
      return event.isTrusted
    }
    to.addEventListener('click', (event) => own(event) && setMenu(menu.hidden === true))

    // The menu: a new chat with each agent that can start, then the task's conversations under its title.
    const group = (heading: string, icon: keyof typeof ICONS, choices: (Destination & { row: string })[]): void => {
      if (!choices.length) return
      if (menu.childElementCount) menu.append(Object.assign(document.createElement('div'), { className: 'sep' }))
      menu.append(Object.assign(document.createElement('div'), { className: 'group', textContent: heading }))
      for (const choice of choices) {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('role', 'menuitemradio')
        button.innerHTML = ICONS[icon]
        button.append(choice.row)
        button.addEventListener('click', (event) => {
          if (!own(event)) return
          choose(choice)
          closeMenu(true)
        })
        rows.push({ button, choice })
        menu.append(button)
      }
    }
    const fillMenu = (answer: Extract<AskOpened, { ok: true }>): void => {
      group(
        'New chat',
        'plus',
        answer.agents.map((agent) => ({
          sessionId: null,
          agent: agent.key,
          label: `New chat · ${agent.label}`,
          row: agent.label,
        })),
      )
      group(
        answer.task || 'This task',
        'message-square',
        answer.sessions.map((session) => {
          const title = session.title || 'Untitled chat'
          return { sessionId: session.id, agent: null, label: title, row: title }
        }),
      )
      // The remembered agent's new chat, else the first agent's.
      const first = rows.find((row) => row.choice.agent === answer.agent) ?? rows.find((row) => row.choice.agent)
      if (first) choose(first.choice)
      else showTo('message-square', 'No agent can start on this Node')
      to.disabled = !rows.length
      to.hidden = false
    }

    // The background screenshots the element, so the box shows only once it has, two frames after the
    // outline left the screen.
    const opening = async (): Promise<void> => {
      await new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted)))
      if (box !== opened) return
      const { x, y, width, height } = element.getBoundingClientRect()
      const answer = (await message({
        type: 'acorn:ask.open',
        rect: { x, y, width, height },
        devicePixelRatio,
      })) as AskOpened | undefined
      if (box !== opened) return void (answer?.ok && cancel(answer.pickId))
      host.style.visibility = ''
      question.focus()
      if (!answer?.ok) return say(answer?.reason ?? "Acorn didn't answer. Reload the page, then try again.")
      if (!answer.screenshot) say(NO_SCREENSHOT)
      pickId = answer.pickId
      fillMenu(answer)
      ready = true
      update()
    }
    void opening()

    const submit = async (): Promise<void> => {
      if (send.disabled || !pickId) return
      sending = true
      update()
      say(null)
      const { width, height } = element.getBoundingClientRect()
      const answer = (await message({
        type: 'acorn:ask.send',
        pickId,
        question: question.value.trim(),
        html: cleanHtml(element),
        selector: cssPath(element),
        size: { width: Math.round(width), height: Math.round(height) },
        sessionId: destination!.sessionId,
        agent: destination!.agent,
      })) as AskSent | undefined
      if (box !== opened) return
      sending = false
      if (!answer?.ok) {
        say(answer?.reason ?? "Acorn didn't answer, so nothing was sent. Reload the page, then try again.")
        return update()
      }
      // The background forgot the pick once it went.
      pickId = null
      if (answer.opensPanel) return stop()
      ready = false
      update()
      say('Sent. Click Acorn in the toolbar to see the reply.')
      setTimeout(() => box === opened && stop(), SENT_NOTE_MS)
    }
    // The person's own click or Enter. Shift+Enter adds a line.
    send.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.isTrusted) void submit()
    })
    question.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || !event.isTrusted) return
      event.preventDefault()
      void submit()
    })
    question.addEventListener('input', update)
    // Any other click in the box closes the To menu.
    box.addEventListener('click', () => closeMenu())
    // What the person types stays out of the page's own shortcuts. The page's capture-phase listeners
    // still see it first, which nothing in the box can stop.
    for (const type of ['keydown', 'keyup', 'keypress']) box.addEventListener(type, (event) => event.stopPropagation())
    root.append(box)
    host.style.visibility = 'hidden'
    document.documentElement.append(host)
    place()
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  const pick = (mode: Mode): void => (mode === 'target' && rightClicked?.isConnected ? ask(rightClicked) : hover())
  scope.acornPicker = pick

  // Every listener below is on the window in the capture phase, so it runs before the page's own.
  window.addEventListener(
    'contextmenu',
    (event) => {
      if (event.isTrusted && event.target instanceof Element && event.target !== host) rightClicked = event.target
    },
    true,
  )
  window.addEventListener(
    'mouseover',
    (event) => {
      if (!hovering || !(event.target instanceof Element)) return
      target = event.target
      outline.hidden = false
      place()
    },
    true,
  )
  // While the person points, the page sees none of the pointer's presses, so picking a button doesn't
  // also press it. The host takes no pointer events then, so the outline is never what's picked.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    window.addEventListener(
      type,
      (event) => {
        if (!hovering) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (type === 'click' && event.isTrusted && event.target instanceof Element) ask(event.target)
      },
      true,
    )
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !event.isTrusted || !(hovering || box)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      // Escape closes the To menu first, then the box.
      if (!closeMenu(true)) stop()
    },
    true,
  )
  // Scrolls inside the page's own panes too.
  // A click on the page closes the To menu.
  document.addEventListener('click', () => closeMenu())
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
  // A tab switch or a navigation closes the box.
  document.addEventListener('visibilitychange', () => document.hidden && stop())
  window.addEventListener('pagehide', stop)
  window.addEventListener('popstate', stop)

  api.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const message = raw as PickerMessage | null
    if (message?.type !== 'acorn:pick') return
    pick(message.mode)
    // Tells the background the picker is here. The chip's script on the same page answers nothing.
    sendResponse(true)
    return true
  })
}
