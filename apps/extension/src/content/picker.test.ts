// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AskMessage, AskOpened, PickerMessage } from '../handoffs'

// The element picker against a real DOM. The browser side is a stub: the message listener the
// background talks to, and the background's answers to the box. The picker draws in a closed shadow root, which the page can't reach, so the
// test keeps the root as it is attached. jsdom can only make events a page could make, which the
// picker ignores, so the person's own events go straight to the listeners the picker added.
type Listener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown
let listener: Listener | undefined
let root: ShadowRoot | undefined
const listeners = new Map<EventTarget, { type: string; listener: EventListener }[]>()

beforeEach(async () => {
  document.body.innerHTML = '<main><button class="save">Save</button><p class="other">Other</p></main>'
  root = undefined
  answers = []
  listeners.clear()
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) {
    root = attachShadow.call(this, init)
    return root
  })
  // jsdom's window has its own `addEventListener`, apart from every other target's.
  for (const target of [EventTarget.prototype, window]) {
    const addEventListener = target.addEventListener
    vi.spyOn(target, 'addEventListener').mockImplementation(function (this: EventTarget, type, added, options) {
      listeners.set(this, [...(listeners.get(this) ?? []), { type, listener: added as EventListener }])
      return addEventListener.call(this, type, added, options)
    })
  }
  // jsdom paints no frames, so the picker's wait for the outline to leave the screen ends at once.
  vi.stubGlobal('requestAnimationFrame', (painted: FrameRequestCallback) => (painted(0), 0))
  const scope = globalThis as Record<string, unknown>
  delete scope.acornPicker
  sent = []
  answer = (message) => (message.type === 'acorn:ask.open' ? OPENED : { ok: true, opensPanel: true })
  scope.chrome = {
    runtime: {
      onMessage: { addListener: (added: Listener) => void (listener = added) },
      sendMessage: async (message: AskMessage) => {
        sent.push(message)
        return answer(message)
      },
    },
  }
  vi.resetModules()
  await import('./picker')
})
afterEach(() => {
  // Each test imports its own copy of the script. Escape takes away what the last one drew.
  person('keydown', document.body, { key: 'Escape' })
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (globalThis as Record<string, unknown>).chrome
})

// What the box sent the background, and how the background answers.
let sent: AskMessage[] = []
let answer: (message: AskMessage) => unknown
const OPENED: AskOpened = {
  ok: true,
  pickId: 'pick-1',
  task: 'Fix billing rounding',
  sessions: [{ id: 's1', title: 'Billing rounding' }],
  agents: [
    { key: 'claude::', label: 'Claude' },
    { key: 'claude:work:', label: 'Claude · work' },
  ],
  agent: 'claude:work:',
  screenshot: true,
}

// What the picker answered, which tells the background it's on the page.
let answers: unknown[] = []
const pick = (mode: PickerMessage['mode']) =>
  listener?.({ type: 'acorn:pick', mode } satisfies PickerMessage, {}, (answer) => answers.push(answer))
const element = (selector: string) => document.querySelector(selector)!
const drawn = () => document.querySelector('[data-acorn-picker]')
const outline = () => root!.querySelector<HTMLElement>('.outline')!
const box = () => (drawn() ? root!.querySelector<HTMLElement>('.box') : null)

// The person's own event at `target`, delivered to the listeners the picker added on `on`: the
// window, unless it says otherwise.
function person(type: string, target: EventTarget, extra: Record<string, unknown> = {}, on: EventTarget = window) {
  const event = {
    type,
    target,
    isTrusted: true,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    ...extra,
  }
  for (const added of listeners.get(on) ?? []) if (added.type === type) added.listener(event as unknown as Event)
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const field = () => box()!.querySelector('textarea')!
const to = () => box()!.querySelector<HTMLButtonElement>('.to')!
const menu = () => box()!.querySelector<HTMLElement>('[role="menu"]')!
// The To menu's groups and rows, a group's heading in brackets, as the person reads them.
const menuLines = () =>
  [...menu().children].flatMap((line) =>
    line.className === 'sep' ? [] : line.className === 'group' ? [`[${line.textContent}]`] : [line.textContent],
  )
const row = (name: string) =>
  [...menu().querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((each) => each.textContent === name)!
// The person opens To and picks the row reading `name`.
function sendTo(name: string) {
  person('click', to(), {}, to())
  person('click', row(name), {}, row(name))
}
const send = () => box()!.querySelector<HTMLButtonElement>('.send')!
const note = () => box()!.querySelector<HTMLElement>('.note')!
const type = (text: string) => {
  field().value = text
  field().dispatchEvent(new Event('input'))
}
// The box open on the element at `selector`, with the background's answer in.
async function asked(selector: string) {
  person('contextmenu', element(selector))
  pick('target')
  await settle()
}
// What the box sends about the element at `selector`, for a question and a press of Send.
async function sentAbout(selector: string) {
  await asked(selector)
  type('Why?')
  person('click', send(), {}, send())
  await settle()
  return sent.find((message) => message.type === 'acorn:ask.send') as Extract<AskMessage, { type: 'acorn:ask.send' }>
}

describe('the element picker', () => {
  it('opens the box beside the element the person right-clicked, once the background has its screenshot', async () => {
    person('contextmenu', element('.save'))
    expect(pick('target')).toBe(true)
    expect(answers).toEqual([true])
    expect(drawn()?.parentElement).toBe(document.documentElement)
    expect(outline().hidden).toBe(true)
    expect((drawn() as HTMLElement).style.visibility).toBe('hidden')
    await settle()
    expect((drawn() as HTMLElement).style.visibility).toBe('')
    expect(box()!.getAttribute('aria-label')).toBe('Ask Acorn about this element')
    expect(box()!.dataset.theme).toBe('light')
    expect(root!.activeElement).toBe(box()!.querySelector('textarea'))
    // jsdom lays nothing out, so the element is 0 by 0.
    expect(box()!.querySelector('.element')!.textContent).toBe('button.save · 0 × 0')
    expect(box()!.querySelector('.element svg')).not.toBeNull()
    expect([...box()!.querySelectorAll('.bar > button')].map((button) => button.textContent)).toEqual([
      'New chat · Claude · work',
      'esc',
      'Send ↵',
    ])
    expect(box()!.querySelector('.cancel')!.getAttribute('aria-label')).toBe('Cancel')
  })

  it('lets the person point at an element when there is no right-click to use', () => {
    // A page can make a right-click, but not the person's.
    element('.save').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    pick('target')
    expect(box()).toBeNull()
    expect(drawn()).not.toBeNull()

    person('mouseover', element('.other'))
    expect(outline().hidden).toBe(false)
    // A click the page made picks nothing.
    element('.save').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(box()).toBeNull()
    person('click', element('.save'))
    expect(box()).not.toBeNull()
    expect(outline().hidden).toBe(true)
  })

  it('cancels the pointing, and the box, on Escape', () => {
    pick('hover')
    person('mouseover', element('.save'))
    person('keydown', document.body, { key: 'Escape' })
    expect(drawn()).toBeNull()
    // Clicks are the page's own again.
    person('click', element('.save'))
    expect(drawn()).toBeNull()

    person('contextmenu', element('.save'))
    pick('target')
    person('keydown', drawn()!, { key: 'Escape' })
    expect(drawn()).toBeNull()
  })

  it("closes the box on the person's Cancel, and when the element leaves the page", async () => {
    person('contextmenu', element('.save'))
    pick('target')
    const cancel = box()!.querySelector('.cancel')!
    // Only the person's own click.
    ;(cancel as HTMLButtonElement).click()
    expect(box()).not.toBeNull()
    person('click', cancel, {}, cancel)
    expect(drawn()).toBeNull()

    pick('target')
    element('.save').remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(drawn()).toBeNull()
  })

  it('keeps what the person types in the box out of the page', () => {
    person('contextmenu', element('.save'))
    pick('target')
    const typed = vi.fn()
    document.body.addEventListener('keydown', typed)
    box()!
      .querySelector('textarea')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, composed: true }))
    expect(typed).not.toHaveBeenCalled()
  })

  it('fills the box from the background, and sends a new chat with the agent chosen', async () => {
    await asked('.save')
    expect(sent).toEqual([{ type: 'acorn:ask.open', rect: { x: 0, y: 0, width: 0, height: 0 }, devicePixelRatio: 1 }])
    expect(note().hidden).toBe(true)
    // To names the remembered agent's new chat, and its menu holds every destination.
    expect(to().getAttribute('aria-label')).toBe('To: New chat · Claude · work')
    expect(menu().hidden).toBe(true)
    person('click', to(), {}, to())
    expect(menu().hidden).toBe(false)
    expect(to().getAttribute('aria-expanded')).toBe('true')
    expect(menuLines()).toEqual(['[New chat]', 'Claude', 'Claude · work', '[Fix billing rounding]', 'Billing rounding'])
    expect(row('Claude · work').getAttribute('aria-checked')).toBe('true')
    // A click elsewhere in the box closes it, and leaves focus where the click put it.
    field().focus()
    person('click', box()!, {}, box()!)
    expect(menu().hidden).toBe(true)
    expect(root!.activeElement).toBe(field())
    expect(send().disabled).toBe(true)

    type('  Why is this here?  ')
    expect(send().disabled).toBe(false)
    // A click the page made sends nothing.
    send().click()
    expect(sent).toHaveLength(1)
    person('click', send(), {}, send())
    await settle()
    expect(sent[1]).toEqual({
      type: 'acorn:ask.send',
      pickId: 'pick-1',
      question: 'Why is this here?',
      html: '<button class="save">Save</button>',
      selector: 'body > main:nth-of-type(1) > button:nth-of-type(1)',
      size: { width: 0, height: 0 },
      sessionId: null,
      agent: 'claude:work:',
    })
    // The panel opens on the chat, so the box goes, and the background has already forgotten the pick.
    expect(drawn()).toBeNull()
    expect(sent).toHaveLength(2)
  })

  it('sends to a chosen conversation on Enter, and keeps Shift+Enter for a new line', async () => {
    await asked('.save')
    sendTo('Billing rounding')
    expect(menu().hidden).toBe(true)
    expect(root!.activeElement).toBe(to())
    expect(to().textContent).toBe('Billing rounding')
    expect(row('Billing rounding').getAttribute('aria-checked')).toBe('true')
    type('Why?')
    person('keydown', field(), { key: 'Enter', shiftKey: true }, field())
    await settle()
    expect(sent).toHaveLength(1)
    person('keydown', field(), { key: 'Enter' }, field())
    await settle()
    expect(sent[1]).toMatchObject({ type: 'acorn:ask.send', sessionId: 's1', agent: null })
  })

  it('closes the To menu on Escape, then the box', async () => {
    await asked('.save')
    person('click', to(), {}, to())
    person('keydown', document.body, { key: 'Escape' })
    expect(menu().hidden).toBe(true)
    expect(box()).not.toBeNull()
    // So does a click on the page.
    person('click', to(), {}, to())
    person('click', document.body, {}, document)
    expect(menu().hidden).toBe(true)
    person('keydown', document.body, { key: 'Escape' })
    expect(drawn()).toBeNull()
  })

  it('starts a new chat with another agent, and says when nothing can take the question', async () => {
    await asked('.save')
    sendTo('Claude')
    expect(to().textContent).toBe('New chat · Claude')
    type('Why?')
    person('click', send(), {}, send())
    await settle()
    expect(sent.at(-1)).toMatchObject({ type: 'acorn:ask.send', sessionId: null, agent: 'claude::' })

    answer = (message) =>
      message.type === 'acorn:ask.open' ? { ...OPENED, sessions: [], agents: [], agent: null } : { ok: true }
    await asked('.save')
    expect(to().textContent).toBe('No agent can start on this Node')
    expect(to().disabled).toBe(true)
    type('Why?')
    expect(send().disabled).toBe(true)
  })

  it("keeps the box open with the background's reason, and forgets the pick on Escape", async () => {
    answer = (message) =>
      message.type === 'acorn:ask.open' ? OPENED : { ok: false, reason: "The Node didn't confirm this message." }
    await sentAbout('.save')
    expect(note().hidden).toBe(false)
    expect(note().textContent).toBe("The Node didn't confirm this message.")
    expect(send().disabled).toBe(false)

    // Cancel tells the background to forget the pick.
    person('keydown', document.body, { key: 'Escape' })
    expect(sent.at(-1)).toEqual({ type: 'acorn:ask.cancel', pickId: 'pick-1' })
  })

  it('says when the question goes without a screenshot', async () => {
    answer = (message) => (message.type === 'acorn:ask.open' ? { ...OPENED, screenshot: false } : { ok: true })
    await asked('.save')
    expect(note().textContent).toBe("This goes without a screenshot: the browser didn't allow one here.")
    type('Why?')
    expect(send().disabled).toBe(false)
  })

  it('says why the box cannot send when the background refuses it', async () => {
    answer = () => ({ ok: false, reason: "This page doesn't belong to a task." })
    await asked('.save')
    expect(note().textContent).toBe("This page doesn't belong to a task.")
    type('Why?')
    expect(send().disabled).toBe(true)
  })

  it('says where the reply is in Firefox, then closes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    answer = (message) => (message.type === 'acorn:ask.open' ? OPENED : { ok: true, opensPanel: false })
    person('contextmenu', element('.save'))
    pick('target')
    await vi.advanceTimersByTimeAsync(0)
    type('Why?')
    person('click', send(), {}, send())
    await vi.advanceTimersByTimeAsync(0)
    expect(note().textContent).toBe('Sent. Click Acorn in the toolbar to see the reply.')
    expect(send().disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(4000)
    expect(drawn()).toBeNull()
    vi.useRealTimers()
  })

  it("cleans the element's HTML", async () => {
    document.body.innerHTML = `<main><div class="card" id="card" style="color: red" role="region" aria-label="Card" data-row="3" onclick="steal()">
        <script>secret()</script><style>.x {}</style><noscript>no</noscript><template><p>t</p></template>
        <link rel="stylesheet" href="x.css"><meta name="x"><input type="hidden" name="csrf" value="token">
        <input name="email" value="me@example.com" onfocus="x()">
        <img src="data:image/png;base64,AAAA" srcset="a.png 1x, data:image/png;base64,BBBB 2x" alt="Logo">
        <a href="blob:https://example.test/1">Download</a> <video poster="https://example.test/p.jpg"></video>
        <iframe srcdoc="<p>hi</p>"></iframe>
      </div></main>`
    expect((await sentAbout('#card')).html).toBe(
      '<div class="card" id="card" style="color: red" role="region" aria-label="Card" data-row="3"> ' +
        '<input name="email"> <img src="[data URL]" srcset="[data URL]" alt="Logo"> ' +
        '<a href="[data URL]">Download</a> <video poster="https://example.test/p.jpg"></video> <iframe></iframe> </div>',
    )
  })

  it('cuts HTML over 50 KiB, and says how much more there was', async () => {
    document.body.innerHTML = `<p class="long">${'word '.repeat(30_000)}</p>`
    const { html } = await sentAbout('.long')
    expect(new TextEncoder().encode(html).byteLength).toBeLessThanOrEqual(50 * 1024)
    expect(html).toMatch(/<!-- truncated by Acorn: 97 KiB more -->$/)
  })

  it('builds the shortest CSS path that matches only the element', async () => {
    document.body.innerHTML = `
      <div id="app"><section><p>One</p><p>Two <b class="target">here</b></p></section></div>
      <button data-testid="save">Save</button><button id="both" data-testid="both">Both</button><button id="twice">A</button><button id="twice">B</button>
      <ul><li>One</li><li class="second">Two</li></ul>`
    const selectors = []
    for (const selector of [
      '#app',
      '.target',
      '[data-testid="save"]',
      'button[data-testid="both"]',
      '#twice + #twice',
      '.second',
    ]) {
      sent = []
      selectors.push((await sentAbout(selector)).selector)
      person('keydown', document.body, { key: 'Escape' })
    }
    expect(selectors).toEqual([
      '#app',
      '#app > section:nth-of-type(1) > p:nth-of-type(2) > b:nth-of-type(1)',
      '[data-testid="save"]',
      // The element's own ID comes before its test ID.
      '#both',
      'body > button:nth-of-type(4)',
      'body > ul:nth-of-type(1) > li:nth-of-type(2)',
    ])
    for (const selector of selectors) expect(document.querySelectorAll(selector)).toHaveLength(1)
  })
})
