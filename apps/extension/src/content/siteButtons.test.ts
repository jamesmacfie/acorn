// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppMarker, ChipTask, ContentMessage } from '../handoffs'

// The content script against a real DOM. The browser side is a stub: the message listener the
// background talks to, and `sendMessage` for a click. Each chip draws in a closed shadow root, which
// the page can't reach, so the test keeps the roots as they are attached.
type Listener = (message: unknown) => void
let listener: Listener | undefined
let sent: unknown[] = []
const roots = new Map<Element, ShadowRoot>()
// Every listener the script adds, so a click can be delivered as the person's own: jsdom can only make
// events a page could make, which the script ignores.
const listeners = new Map<EventTarget, { type: string; listener: EventListener }[]>()

beforeEach(async () => {
  document.body.innerHTML = '<header class="item"><div class="actions"><button>Edit</button></div></header>'
  sent = []
  roots.clear()
  listeners.clear()
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    const root = attachShadow.call(this, init)
    roots.set(this, root)
    return root
  })
  const addEventListener = EventTarget.prototype.addEventListener
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type,
    added,
    options,
  ) {
    listeners.set(this, [...(listeners.get(this) ?? []), { type, listener: added as EventListener }])
    return addEventListener.call(this, type, added, options)
  })
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
  // Each test imports its own copy of the script. Telling it to draw nothing stops its observer, and
  // takes away the marker, which sits outside the body the next test resets.
  listener?.({ type: 'acorn:buttons', buttons: [], marker: null, opensLinks: true, opensPanel: true })
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).chrome
})

type Button = ContentMessage['buttons'][number]
const show = (buttons: Button[], page: Partial<Omit<ContentMessage, 'type' | 'buttons'>> = {}) =>
  listener?.({
    type: 'acorn:buttons',
    buttons,
    marker: null,
    opensLinks: true,
    opensPanel: true,
    ...page,
  } satisfies ContentMessage)
const frame = () => new Promise((resolve) => setTimeout(resolve, 40))
const drawn = () => [...document.querySelectorAll('[data-acorn-handoff]')]
const chip = (index = 0) => roots.get(drawn()[index]!)!
const main = () => chip().querySelector<HTMLButtonElement>('.main')!
const menu = () => chip().querySelector<HTMLElement>('[role="menu"]')
// A separator reads as '-'.
const entries = (list: Element | null | undefined) =>
  [...(list?.children ?? [])].map((item) => (item.getAttribute('role') === 'separator' ? '-' : item.textContent))
const items = () => entries(menu())
const item = (name: string) => [...menu()!.children].find((element) => element.textContent === name) as HTMLElement

// The person's own click, delivered through the listeners the script added, bubbling to the chip.
function press(element: Node) {
  let stopped = false
  const event = { type: 'click', isTrusted: true, preventDefault() {}, stopPropagation: () => (stopped = true) }
  for (let node: Node | null = element; node && !stopped; node = node.parentNode)
    for (const { type, listener } of listeners.get(node) ?? [])
      if (type === 'click') listener(event as unknown as Event)
}

const button = (task: ChipTask | null = null): Button => ({
  key: 'tracker:item',
  label: 'Open in Acorn',
  anchors: ['.actions'],
  task,
})
const task: ChipTask = {
  title: 'Fix billing rounding',
  state: { label: '2 working', tone: 'ok' },
  link: 'acorn://n1/t/t1?pane=pr',
}

describe('task chips in the page', () => {
  it('draws one chip at the end of the first anchor that matches, with plugin and task text as text', () => {
    show([
      {
        ...button({ ...task, title: '<img src=x onerror=alert(1)>' }),
        label: '<b>label</b>',
        anchors: ['.missing', 'not a [selector', '.actions'],
      },
    ])
    expect(drawn()).toHaveLength(1)
    expect(drawn()[0]!.parentElement?.className).toBe('actions')
    expect(drawn()[0]!.previousElementSibling?.textContent).toBe('Edit')
    expect(chip().querySelector('.name')!.textContent).toBe('Open task')
    expect(main().title).toBe('<img src=x onerror=alert(1)>')
    expect(main().getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>, 2 working (<b>label</b>)')
    expect(chip().querySelector('img, b')).toBeNull()
    expect(document.querySelector('img, b')).toBeNull()
  })

  it('keeps one chip through a page that redraws its header', async () => {
    show([button()])
    document.body.innerHTML = '<header class="item"><div class="actions"></div></header>'
    await frame()
    expect(drawn()).toHaveLength(1)
    show([button()])
    expect(drawn()).toHaveLength(1)
  })

  it('draws nothing without an anchor, and removes chips it is no longer given', () => {
    show([{ ...button(), anchors: ['.nowhere'] }])
    expect(drawn()).toHaveLength(0)
    show([button()])
    expect(drawn()).toHaveLength(1)
    show([])
    expect(drawn()).toHaveLength(0)
  })

  it("takes the page's theme and its buttons' height", () => {
    show([button(task)])
    expect(chip().querySelector<HTMLElement>('.chip')!.dataset.theme).toBe('light')
    document.querySelector<HTMLElement>('.actions')!.style.color = 'rgb(230, 237, 243)'
    show([button(task)])
    expect(chip().querySelector<HTMLElement>('.chip')!.dataset.theme).toBe('dark')
    // jsdom lays nothing out, so the site's button reads as no height and the chip takes the usual one.
    expect(chip().querySelector<HTMLElement>('.chip')!.style.getPropertyValue('--height')).toBe('28px')
  })

  it("takes the site button's font, and the header's gap in place of its own margin", () => {
    show([button(task)])
    expect(drawn()[0]!.getAttribute('style')).toContain('margin-left: 8px')
    document.body.innerHTML =
      '<header class="item"><div class="actions" style="display: flex; column-gap: 8px">' +
      '<button style="font-weight: 500; font-size: 14px; font-family: Arial">Edit</button></div></header>'
    show([button(task)])
    expect(drawn()[0]!.getAttribute('style')).toContain('margin-left: 0')
    expect(chip().querySelector<HTMLElement>('.chip')!.style.getPropertyValue('--font')).toBe('500 14px/1 Arial')
  })

  it("reads Open task with the task's agents, opens the panel on it, and offers the task's verbs", async () => {
    show([button({ ...task, state: { label: '1 waiting', tone: 'warn' } })])
    expect(main().textContent).toBe('Open task1 waiting')
    expect(main().title).toBe('Fix billing rounding')
    expect(chip().querySelector<HTMLElement>('.state')!.dataset.tone).toBe('warn')
    press(main())
    expect(sent).toEqual([{ type: 'acorn:chip', key: 'tracker:item', action: 'show' }])

    expect(menu()!.hidden).toBe(true)
    press(chip().querySelector('.more')!)
    expect(menu()!.hidden).toBe(false)
    expect(items()).toEqual([
      'Show in side panel',
      'New chat about this page',
      'Ask about an element',
      '-',
      'Open in Acorn',
      'Copy Acorn link',
    ])
    // Each entry leads with its icon.
    for (const entry of menu()!.querySelectorAll('[role="menuitem"]'))
      expect(entry.firstElementChild?.localName).toBe('svg')
    expect(item('Open in Acorn').getAttribute('href')).toBe('acorn://n1/t/t1?pane=pr')
    press(item('New chat about this page'))
    expect(sent.at(-1)).toEqual({ type: 'acorn:chip', key: 'tracker:item', action: 'chat' })
    expect(menu()!.hidden).toBe(true)
  })

  it("starts the element picker from the chip's and the marker's menus, in the page", () => {
    const picker = vi.fn()
    ;(globalThis as Record<string, unknown>).acornPicker = picker
    show([button(task)], {
      marker: { branch: 'fix/billing', state: { label: 'running', tone: 'ok' }, link: null },
    })
    press(item('Ask about an element'))
    const marker = roots.get(document.querySelector('[data-acorn-marker]')!)!
    press(
      [...marker.querySelector('[role="menu"]')!.children].find((each) => each.textContent === 'Ask about an element')!,
    )
    expect(picker.mock.calls).toEqual([['hover'], ['hover']])
    expect(sent).toEqual([])
    delete (globalThis as Record<string, unknown>).acornPicker
  })

  it('copies the Acorn link in place of opening it in a development build', () => {
    show([button(task)], { opensLinks: false })
    expect(items()).toEqual([
      'Show in side panel',
      'New chat about this page',
      'Ask about an element',
      '-',
      'Copy Acorn link',
    ])
  })

  it('leaves out the separator when nothing follows it', () => {
    show([button({ ...task, link: null })])
    expect(items()).toEqual(['Show in side panel', 'New chat about this page', 'Ask about an element'])
  })

  it('reads Start task with no task, and offers to create a task or run a workflow from its menu', () => {
    show([button()])
    expect(main().textContent).toBe('Start task')
    expect(main().getAttribute('aria-label')).toBe('Start task (Open in Acorn)')
    // The chip itself opens the menu, so there is no ▾ beside it.
    expect(chip().querySelector('.more')).toBeNull()
    expect(menu()!.hidden).toBe(true)
    press(main())
    expect(sent).toEqual([])
    expect(menu()!.hidden).toBe(false)
    expect(items()).toEqual(['Create task', 'Run workflow…'])
    press(item('Run workflow…'))
    expect(sent).toEqual([{ type: 'acorn:handoff', key: 'tracker:item', start: 'workflow' }])
    expect(menu()!.hidden).toBe(true)
    press(main())
    press(item('Create task'))
    expect(sent.at(-1)).toEqual({ type: 'acorn:handoff', key: 'tracker:item', start: 'task' })
  })

  it('opens the menu from the chip in Firefox, which opens its panel only from the toolbar', () => {
    show([button(task)], { opensPanel: false })
    expect(chip().querySelector('.more')).toBeNull()
    press(main())
    expect(sent).toEqual([])
    expect(menu()!.hidden).toBe(false)
    expect(items()).toEqual([
      'Ask about an element',
      '-',
      'Open in Acorn',
      'Copy Acorn link',
      'To open the panel on this task, click Acorn in the toolbar.',
    ])

    // With no task a choice hands the page to the background, to wait for the sidebar.
    show([button()], { opensPanel: false })
    press(main())
    expect(items()).toEqual(['Create task', 'Run workflow…', 'Then click Acorn in the toolbar to open the panel.'])
    press(item('Create task'))
    expect(sent).toEqual([{ type: 'acorn:handoff', key: 'tracker:item', start: 'task' }])
  })

  it('ignores a click the page made rather than the person', () => {
    show([button(task)])
    main().click()
    chip().querySelector<HTMLButtonElement>('.more')!.click()
    expect(sent).toEqual([])
    expect(menu()!.hidden).toBe(true)
  })
})

describe('the branch marker on a local app', () => {
  const marker: AppMarker = {
    branch: 'fix/billing-rounding',
    state: { label: 'running', tone: 'ok' },
    link: 'acorn://n1/t/t1?pane=runn',
  }
  const markers = () => [...document.querySelectorAll('[data-acorn-marker]')]
  const pill = () => roots.get(markers()[0]!)!
  const pillMain = () => pill().querySelector<HTMLButtonElement>('.main')!
  const pillItems = () => entries(pill().querySelector('[role="menu"]'))
  const pillItem = (name: string) =>
    [...pill().querySelector('[role="menu"]')!.children].find((element) => element.textContent === name) as HTMLElement

  it("draws the task's branch and the plugin's state in the page's corner, as text", () => {
    show([], { marker: { ...marker, branch: '<img src=x onerror=alert(1)>' } })
    expect(markers()).toHaveLength(1)
    expect(markers()[0]!.parentElement).toBe(document.documentElement)
    expect((markers()[0] as HTMLElement).style.position).toBe('fixed')
    expect(pill().querySelector('.name')!.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(pill().querySelector<HTMLElement>('.state')!.dataset.tone).toBe('ok')
    expect(pill().querySelector('img')).toBeNull()
    expect(document.querySelector('img')).toBeNull()
  })

  it('opens the panel on the task, and its menu hides it on this site', () => {
    show([], { marker })
    expect(pillMain().getAttribute('aria-label')).toBe('fix/billing-rounding, running (Acorn)')
    press(pillMain())
    expect(sent).toEqual([{ type: 'acorn:marker', action: 'show' }])
    press(pill().querySelector('.more')!)
    expect(pillItems()).toEqual([
      'Show in side panel',
      'Ask about an element',
      '-',
      'Open in Acorn',
      'Copy Acorn link',
      '-',
      'Hide on this site',
    ])
    expect(pillItem('Open in Acorn').getAttribute('href')).toBe('acorn://n1/t/t1?pane=runn')
    press(pillItem('Hide on this site'))
    expect(sent.at(-1)).toEqual({ type: 'acorn:marker', action: 'hide' })
  })

  it('opens its menu from the click in Firefox', () => {
    show([], { marker, opensPanel: false })
    expect(pill().querySelector('.more')).toBeNull()
    press(pillMain())
    expect(sent).toEqual([])
    expect(pillItems()).toEqual([
      'Ask about an element',
      '-',
      'Open in Acorn',
      'Copy Acorn link',
      '-',
      'Hide on this site',
      'To open the panel on this task, click Acorn in the toolbar.',
    ])
  })

  it('comes back after the page redraws itself, and goes when it is no longer given', async () => {
    show([button(task)], { marker })
    expect(drawn()).toHaveLength(1)
    markers()[0]!.remove()
    await frame()
    expect(markers()).toHaveLength(1)
    show([button(task)])
    expect(markers()).toHaveLength(0)
    expect(drawn()).toHaveLength(1)
  })
})
