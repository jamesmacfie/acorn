import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { fingerprintWords } from '@acorn/protocol/fingerprintWords.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
import { back, button, goHome, nodeRow, openSettings, pickFrom, useNode } from '../test/sidebarUi'
import { App } from './App'

const FINGERPRINT = 'ab'.repeat(32)
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  document.body.innerHTML = ''
})

type Request = { id: string; op: string; nodeId?: string | null; endpoint?: string; code?: string; label?: string }

// A host that answers like the real one, except that project reads wait until the test releases them.
function mount(
  known: string[],
  options: {
    refuseLateReads?: boolean
    local?: { nodeId: string; endpoint: string }
    // A Node that takes an ask. Without one, the ask fails and only the code works.
    approval?: { allowed: boolean }
  } = {},
) {
  const fake = fakeBrowser()
  const held: { nodeId: string; release(): void }[] = []
  let active: string | null = null
  // Names given in Settings, which the host keeps.
  const names: Record<string, string> = {}
  const nodes = () => ({
    nodes: known.map((nodeId) => ({
      nodeId,
      label: names[nodeId] ?? `Node ${nodeId}`,
      endpoint: `https://${nodeId}.test`,
      local: false,
    })),
    activeNodeId: active,
    status: null,
  })
  fake.onNativeMessage = (raw, host: FakeHost) => {
    const request = raw as Request
    const reply = (result: unknown) => host.send({ v: 1, id: request.id, ok: true, result })
    if (request.op === 'nodes.list') return reply(nodes())
    if (request.op === 'node.select') {
      active = request.nodeId ?? null
      return reply(nodes())
    }
    if (request.op === 'node.forget') {
      known.splice(known.indexOf(request.nodeId!), 1)
      if (active === request.nodeId) active = null
      return reply(nodes())
    }
    if (request.op === 'node.rename') {
      names[request.nodeId!] = request.label!
      return reply(nodes())
    }
    if (request.op === 'node.local')
      return reply(
        options.local
          ? { ...options.local, fingerprint: FINGERPRINT, protocolVersion: 1, baseline: 'b', compatible: true }
          : null,
      )
    if (request.op === 'node.ask')
      return options.approval
        ? reply({ phrase: 'maple river stone' })
        : host.send({ v: 1, id: request.id, ok: false, error: { code: 'pairing_failed', message: 'no ask' } })
    if (request.op === 'node.collect') {
      if (!options.approval?.allowed) return reply(null)
      known.push('new')
      return reply({ nodeId: 'new', label: request.label, endpoint: 'https://new.test', local: false })
    }
    if (request.op === 'node.probe')
      return reply({
        endpoint: request.endpoint,
        fingerprint: FINGERPRINT,
        protocolVersion: 1,
        baseline: 'b',
        compatible: true,
      })
    if (request.op === 'node.pair') {
      if (request.code !== 'GOOD')
        return host.send({
          v: 1,
          id: request.id,
          ok: false,
          error: { code: 'pairing_failed', message: 'Pairing failed. Check the code and try again.' },
        })
      known.push('new')
      return reply({ nodeId: 'new', label: request.label, endpoint: 'https://new.test', local: false })
    }
    // Each Node ties the test page's site to its one project.
    if (request.op === 'sites.list')
      return reply({
        nodeId: request.nodeId,
        sites: [{ projectId: `${request.nodeId}-p`, origin: 'https://example.test', pathPrefix: '/' }],
      })
    if (request.op === 'projects.list') {
      const nodeId = request.nodeId!
      held.push({
        nodeId,
        release: () =>
          options.refuseLateReads && active !== nodeId
            ? host.send({ v: 1, id: request.id, ok: false, error: { code: 'not_selected', message: 'not selected' } })
            : reply({
                nodeId,
                projects: [{ id: `${nodeId}-p`, name: `${nodeId} project`, path: null, hidden: false }],
              }),
      })
    }
  }
  startBackground(fake.api, 'com.acorn.browser_bridge')
  const root = document.createElement('div')
  document.body.append(root)
  dispose = render(() => <App api={fake.api} />, root)
  return { fake, held, root }
}

// Opens a Node's ⋯ menu in Settings. The menu draws in a portal on the body.
async function nodeMenu(root: HTMLElement, label: string) {
  button(nodeRow(root, label)!, 'Node actions')!.click()
  await settle()
}
const menuItems = () => [...document.querySelectorAll('[role="menu"] .ui-menu-item')].map((item) => item.textContent)
async function chooseItem(label: string) {
  ;[...document.querySelectorAll<HTMLButtonElement>('[role="menu"] .ui-menu-item')]
    .find((item) => item.textContent?.startsWith(label))!
    .click()
  await settle()
}

// The selected Node, as the acorn on Home names it.
const shownNode = (root: HTMLElement) => root.querySelector('header .mark')!.getAttribute('aria-label')
const input = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
// Submits the form on screen: each pairing step shows one.
const submit = (root: HTMLElement) =>
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const header = (root: HTMLElement) => root.querySelector('header')!
// The one title each screen has, then any settings section's.
const screenTitles = (root: HTMLElement) =>
  [...root.querySelectorAll('.ui-empty-title, .ui-settings-section-label')].map((title) => title.textContent)
const localCard = (root: HTMLElement) => root.querySelector<HTMLElement>('.connect .ui-card')!
// The words on screen to compare, and the phrase they read as.
const words = (root: HTMLElement, phrase?: string) =>
  [...root.querySelectorAll(`.ui-chiprow${phrase ? `[aria-label="${phrase}"]` : ''} .ui-chip-label`)].map(
    (word) => word.textContent,
  )
const sent = (fake: ReturnType<typeof fakeBrowser>, op: string) =>
  fake.hosts.flatMap((host) => host.received as Request[]).filter((request) => request.op === op)
const type = (element: HTMLInputElement, value: string) => {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('sidebar', () => {
  it('keeps the selected Node projects when an earlier Node answers late', async () => {
    const { held, root } = mount(['a', 'b'])
    await settle()
    await useNode(root, 'Node a')
    // Home and Settings each read the projects.
    expect(new Set(held.map((read) => read.nodeId))).toEqual(new Set(['a']))
    // Switch to b while a's reads are still out, then let them all answer, b's first.
    await useNode(root, 'Node b')
    for (const read of held.filter((each) => each.nodeId === 'b')) read.release()
    for (const read of held.filter((each) => each.nodeId === 'a')) read.release()
    await settle()
    expect(shownNode(root)).toContain('Node b')
    // The page is on b's project's site, which This page suggests only from b's project list.
    button(root.querySelector('[aria-label="This page"]')!, 'Project')!.click()
    await settle()
    const options = [...document.querySelectorAll('.repo-picker-popover .repo-picker-name > span')]
    expect(options.map((option) => option.textContent)).toEqual(['b project'])
  })

  it('keeps Nodes off Home, behind the gear, and says when the selected Node is offline', async () => {
    const { fake, root } = mount(['a'])
    await settle()
    await useNode(root, 'Node a')
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()
    expect(root.querySelector('[data-settings-section="nodes"]')).toBeNull()
    await openSettings(root)
    expect(root.querySelector('.view[aria-label="Home"]')).toBeNull()
    expect(nodeRow(root, 'Node a')!.textContent).toContain('In use')
    await pickFrom(root, 'Theme', 'Nord')
    expect(fake.storage.get('appearance')).toEqual({ theme: 'nord', style: 'terminal' })
    button(root, 'Cozy')!.click()
    await settle()
    expect(fake.storage.get('appearance')).toEqual({ theme: 'nord', style: 'cozy' })
    await back(root)
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()

    expect(root.querySelector('[data-testid="node-status"]')).toBeNull()
    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'a', state: 'offline' } })
    await settle()
    expect(root.querySelector('header .dot')!.getAttribute('data-tone')).toBe('bad')
    const strip = root.querySelector('[data-testid="node-status"]')!
    expect(strip.textContent).toBe('Node a is offlineRetry')
    // Home stays readable under the strip.
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()

    // Retry asks again, and the answer brings the Node back.
    const lists = () => fake.hosts[0]!.received.filter((message) => (message as Request).op === 'nodes.list').length
    const before = lists()
    button(strip, 'Retry')!.click()
    await settle()
    expect(lists()).toBe(before + 1)
    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'a', state: 'online' } })
    await settle()
    expect(root.querySelector('[data-testid="node-status"]')).toBeNull()
    expect(root.querySelector('header .dot')!.getAttribute('data-tone')).toBe('ok')
  })

  it("pairs the Node on this Mac with a code when it can't take an ask, then offers what comes next", async () => {
    const { fake, root } = mount([], { local: { nodeId: 'new', endpoint: 'https://127.0.0.1:4317' } })
    await settle()
    // With nothing paired, the panel opens on pairing, under a bare top bar with nowhere else to go.
    expect(screenTitles(root)).toEqual(['Connect to Acorn'])
    expect(header(root).textContent).toBe('Acorn')
    expect(button(header(root), 'Settings')).toBeUndefined()
    expect(localCard(root).textContent).toContain('This computerhttps://127.0.0.1:4317')
    button(localCard(root), 'Connect')!.click()
    await settle()

    // The Node took no ask, so the code is the only way, with no name to fill in.
    expect(screenTitles(root)).toEqual(['Enter the pairing code'])
    expect(root.textContent).toContain('In Acorn: Settings › Nodes › Pair a browser')
    expect(input(root, 'label')).toBeNull()
    type(input(root, 'pairing-code'), 'WRONG')
    submit(root)
    await settle()
    expect(root.textContent).toContain('Pairing failed. Check the code and try again.')

    type(input(root, 'pairing-code'), ' GOOD ')
    submit(root)
    await settle()
    expect(sent(fake, 'node.pair').at(-1)).toMatchObject({ code: 'GOOD', label: 'This computer' })
    expect(screenTitles(root)).toEqual(['Connected to This computer', 'Notifications'])
    button(root, 'Done')!.click()
    await settle()
    expect(root.querySelector('.view[aria-label="Home"]')).not.toBeNull()
    expect(shownNode(root)).toContain('Node new')
  })

  it('Connect asks Acorn to allow this browser, and pairs once it does', async () => {
    const approval = { allowed: false }
    const { fake, root } = mount([], { local: { nodeId: 'new', endpoint: 'https://127.0.0.1:4317' }, approval })
    await settle()
    button(localCard(root), 'Connect')!.click()
    await settle()
    // The words Acorn's dialog shows, with the code a click away.
    expect(screenTitles(root)).toEqual(['Approve in Acorn'])
    expect(words(root, 'maple river stone')).toEqual(['maple', 'river', 'stone'])
    expect(root.textContent).toContain('Waiting for approval')
    expect(input(root, 'pairing-code')).toBeNull()
    expect(button(root, 'Use a pairing code instead')).toBeDefined()

    approval.allowed = true
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    await settle()
    expect(sent(fake, 'node.collect').at(-1)).toMatchObject({ label: 'This computer' })
    expect(screenTitles(root)[0]).toBe('Connected to This computer')
  })

  it('Use a pairing code instead pairs with a code while Acorn waits', async () => {
    const { fake, root } = mount([], {
      local: { nodeId: 'new', endpoint: 'https://127.0.0.1:4317' },
      approval: { allowed: false },
    })
    await settle()
    button(localCard(root), 'Connect')!.click()
    await settle()
    button(root, 'Use a pairing code instead')!.click()
    await settle()
    type(input(root, 'pairing-code'), 'GOOD')
    submit(root)
    await settle()
    expect(sent(fake, 'node.pair').at(-1)).toMatchObject({ code: 'GOOD', label: 'This computer' })
    expect(screenTitles(root)[0]).toBe('Connected to This computer')
    // Pairing stopped asking whether Acorn allowed it.
    const collects = sent(fake, 'node.collect').length
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    expect(sent(fake, 'node.collect').length).toBe(collects)
  })

  it('shows another address its identity words, and asks for the code only once they match', async () => {
    const { fake, root } = mount([], { refuseLateReads: true })
    await settle()
    // No Node on this Mac: no card, and the other way in is a plain button.
    expect(root.querySelector('.connect .ui-card')).toBeNull()
    button(root, 'Connect to another Node')!.click()
    await settle()
    expect(screenTitles(root)).toEqual(['Connect to another Node'])
    // A middle step's Cancel goes back to the first.
    button(header(root), 'Cancel')!.click()
    await settle()
    expect(screenTitles(root)).toEqual(['Connect to Acorn'])
    expect(button(header(root), 'Cancel')).toBeUndefined()
    button(root, 'Connect to another Node')!.click()
    await settle()

    type(input(root, 'address'), 'https://new.test:7443')
    submit(root)
    await settle()
    expect(screenTitles(root)).toEqual(['Check its identity'])
    expect(root.textContent).toContain('new.test:7443 shows these words in Settings › Nodes')
    expect(words(root)).toEqual(fingerprintWords(FINGERPRINT))
    expect(input(root, 'pairing-code')).toBeNull()

    button(root, 'They match')!.click()
    await settle()
    expect(screenTitles(root)).toEqual(['Enter the pairing code'])
    expect(root.textContent).toContain('On new.test:7443: Settings › Nodes › Pair a browser')
    type(input(root, 'pairing-code'), 'GOOD')
    submit(root)
    await settle()
    expect(sent(fake, 'node.pair').at(-1)).toMatchObject({ label: 'new.test:7443' })
    button(root, 'Done')!.click()
    await settle()
    expect(shownNode(root)).toContain('Node new')
  })

  it('pairs another Node from Settings, where Cancel goes back, and forgets one there', async () => {
    const { root } = mount(['a'], { local: { nodeId: 'a', endpoint: 'https://127.0.0.1:4317' } })
    await settle()
    await useNode(root, 'Node a')
    await openSettings(root)
    button(root.querySelector('[data-settings-section="nodes"]')!, 'Pair')!.click()
    await settle()
    // The Node on this Mac is already paired, so it has no card.
    expect(screenTitles(root)).toEqual(['Connect to Acorn'])
    expect(root.querySelector('.connect .ui-card')).toBeNull()
    button(header(root), 'Cancel')!.click()
    await settle()
    // Pairing closes back to Settings, where it was asked for.
    expect(root.querySelector('[aria-label="Settings"]')).not.toBeNull()

    // Forget asks first, in the Node's menu.
    await nodeMenu(root, 'Node a')
    expect(menuItems()).toEqual(['Rename', 'Copy addresshttps://a.test', 'Forget Node a'])
    await chooseItem('Forget Node a')
    expect(menuItems()).toContain('Forget Node a?')
    expect(nodeRow(root, 'Node a')).toBeDefined()
    await chooseItem('Forget Node a?')
    expect(nodeRow(root, 'Node a')).toBeUndefined()
    await goHome(root)
    expect(shownNode(root)).toBe('No Node')
  })

  it('renames a Node in place, where Enter saves and Escape cancels', async () => {
    const { fake, root } = mount(['a', 'b'])
    await settle()
    await useNode(root, 'Node a')
    await openSettings(root)
    const field = () => root.querySelector<HTMLInputElement>('input[name="node-name"]')
    const rename = async (from: string, to: string, key: string) => {
      await nodeMenu(root, from)
      await chooseItem('Rename')
      expect(document.activeElement).toBe(field())
      field()!.value = to
      field()!.dispatchEvent(new Event('input', { bubbles: true }))
      field()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      await settle()
    }
    await rename('Node b', 'Studio', 'Escape')
    expect(field()).toBeNull()
    expect(nodeRow(root, 'Node b')).toBeDefined()

    await rename('Node b', '  Studio Mac ', 'Enter')
    expect(field()).toBeNull()
    expect(nodeRow(root, 'Studio Mac')).toBeDefined()
    const renames = fake.hosts[0]!.received.filter((message) => (message as Request).op === 'node.rename')
    expect(renames).toMatchObject([{ nodeId: 'b', label: 'Studio Mac' }])

    // The top bar's footer in Go to task and Home's acorn name the Node in use by its new name.
    await rename('Node a', 'Laptop', 'Enter')
    await goHome(root)
    expect(shownNode(root)).toContain('Laptop')
  })

  it('shows the install command and a spinner, and carries on once the bridge answers', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const fake = fakeBrowser()
    fake.onNativeConnect = (host) => host.close('Specified native messaging host not found.')
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const root = document.createElement('div')
    document.body.append(root)
    dispose = render(() => <App api={fake.api} />, root)
    await settle()
    // One screen, under a bare top bar: the command as one button that copies it, and a spinner.
    expect(screenTitles(root)).toEqual(['Install the browser bridge'])
    expect(button(header(root), 'Settings')).toBeUndefined()
    expect(root.textContent).toContain('Waiting for the bridge')
    expect(root.textContent).not.toContain('Retry')
    const copy = button(root, 'Copy acorn browser install')!
    expect(copy.textContent).toBe('$acorn browser install')
    copy.click()
    expect(writeText).toHaveBeenCalledWith('acorn browser install')

    // The person installs the bridge; the next check finds it without a click.
    fake.onNativeConnect = () => {}
    fake.onNativeMessage = (raw, host) => {
      const request = raw as Request
      if (request.op === 'nodes.list')
        host.send({ v: 1, id: request.id, ok: true, result: { nodes: [], activeNodeId: null, status: null } })
    }
    vi.advanceTimersByTime(3_000)
    vi.useRealTimers()
    await settle()
    expect(screenTitles(root)).toEqual(['Connect to Acorn'])
  })
})
