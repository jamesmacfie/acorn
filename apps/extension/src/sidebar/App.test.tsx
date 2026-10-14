import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'solid-js/web'
import { fingerprintWords } from '@acorn/protocol/fingerprintWords.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
import { back, button, openSettings, pick, useNode } from '../test/sidebarUi'
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
  options: { refuseLateReads?: boolean; local?: { nodeId: string; endpoint: string } } = {},
) {
  const fake = fakeBrowser()
  const held: { nodeId: string; release(): void }[] = []
  let active: string | null = null
  const nodes = () => ({
    nodes: known.map((nodeId) => ({
      nodeId,
      label: `Node ${nodeId}`,
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
    if (request.op === 'node.local')
      return reply(
        options.local
          ? { ...options.local, fingerprint: FINGERPRINT, protocolVersion: 1, baseline: 'b', compatible: true }
          : null,
      )
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

const nodeChip = (root: HTMLElement) => root.querySelector('header summary')!.textContent
const input = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
// Submits the form on screen: each pairing step shows one.
const submit = (root: HTMLElement) =>
  root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const type = (element: HTMLInputElement, value: string) => {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('sidebar', () => {
  it('keeps the selected Node projects when an earlier Node answers late', async () => {
    const { held, root } = mount(['a', 'b'])
    await settle()
    await useNode(root, 'Node a')
    expect(held.map((read) => read.nodeId)).toEqual(['a'])
    // Switch to b while a's read is still out, then let both answer, b first.
    await useNode(root, 'Node b')
    held[1]!.release()
    held[0]!.release()
    await settle()
    expect(nodeChip(root)).toContain('Node b')
    // The page matches nothing, so This page offers to tie its site to one of b's projects.
    const options = [...root.querySelectorAll('select[name="tie-project"] option')].map((option) => option.textContent)
    expect(options).toEqual(['Choose a project', 'b project'])
  })

  it('keeps Nodes off Home, behind the gear, and says when the selected Node is offline', async () => {
    const { fake, root } = mount(['a'])
    await settle()
    await useNode(root, 'Node a')
    expect(root.querySelector('[aria-label="Home"]')).not.toBeNull()
    expect(root.querySelector('[aria-label="Nodes"]')).toBeNull()
    await openSettings(root)
    expect(root.querySelector('[aria-label="Home"]')).toBeNull()
    expect(root.querySelector('[aria-label="Nodes"]')!.textContent).toContain('Node a')
    await pick(root, 'theme', 'nord')
    expect(fake.storage.get('appearance')).toEqual({ theme: 'nord', style: 'terminal' })
    await back(root)
    expect(root.querySelector('[aria-label="Home"]')).not.toBeNull()

    expect(root.querySelector('[data-testid="node-status"]')).toBeNull()
    fake.hosts[0]!.send({ v: 1, event: 'status', status: { nodeId: 'a', state: 'offline' } })
    await settle()
    expect(root.querySelector('header .dot')!.getAttribute('data-tone')).toBe('bad')
    expect(root.querySelector('[data-testid="node-status"]')!.textContent).toBe(
      'The Node is not answering. Check that it is running and reachable, then retry.',
    )
  })

  it('pairs the Node on this Mac with a code alone, then offers what comes next', async () => {
    const { root } = mount([], { local: { nodeId: 'new', endpoint: 'https://127.0.0.1:4317' } })
    await settle()
    // With nothing paired, the panel opens on pairing, the Node on this Mac first.
    const choose = root.querySelector('[aria-label="Choose a Node"]')!
    expect(choose.textContent).toContain('This computerOn this Machttps://127.0.0.1:4317')
    expect(choose.textContent).toContain("Found in this Mac's Acorn data folder.")
    button(choose, 'Continue')!.click()
    await settle()

    expect(root.textContent).toContain("Checked against this Mac's own certificate")
    expect(root.querySelector('[data-testid="identity-words"]')).toBeNull()
    expect(input(root, 'label').value).toBe('This computer')
    type(input(root, 'pairing-code'), 'WRONG')
    submit(root)
    await settle()
    expect(root.textContent).toContain('Pairing failed. Check the code and try again.')

    type(input(root, 'pairing-code'), ' GOOD ')
    submit(root)
    await settle()
    expect(root.querySelector('[aria-label="Paired"]')!.textContent).toContain('Paired with This computer')
    expect(nodeChip(root)).toContain('Node new')
    expect(root.querySelector('[aria-label="Notifications"]')).not.toBeNull()
    button(root, 'Done')!.click()
    await settle()
    expect(root.querySelector('[aria-label="Home"]')).not.toBeNull()
  })

  it('shows another address its identity words, and asks for the code only once they match', async () => {
    const { root } = mount([], { refuseLateReads: true })
    await settle()
    expect(root.querySelector('[data-testid="local-node-note"]')!.textContent).toBe(
      'No Acorn Node is running on this Mac.',
    )
    button(root, 'Use another address ›')!.click()
    await settle()
    type(input(root, 'address'), 'https://new.test:7443')
    submit(root)
    await settle()
    const words = [...root.querySelectorAll('[data-testid="identity-words"] li')].map((word) => word.textContent)
    expect(words).toEqual(fingerprintWords(FINGERPRINT))
    expect(root.textContent).toContain('Find them in Settings › Nodes in the Acorn app')
    expect(button(root, 'Continue')!.disabled).toBe(true)
    expect(input(root, 'pairing-code')).toBeNull()

    input(root, 'confirm').click()
    await settle()
    button(root, 'Continue')!.click()
    await settle()
    expect(root.textContent).toContain('You confirmed the identity words')
    expect(input(root, 'label').value).toBe('new.test:7443')
    type(input(root, 'pairing-code'), 'GOOD')
    submit(root)
    await settle()
    expect(nodeChip(root)).toContain('Node new')
  })

  it('lists paired Nodes to use while pairing, and pairs another or forgets one from the chip', async () => {
    const { root } = mount(['a'], { local: { nodeId: 'a', endpoint: 'https://127.0.0.1:4317' } })
    await settle()
    await useNode(root, 'Node a')
    button(root.querySelector('header .menu-items')!, 'Pair another')!.click()
    await settle()
    // The Node on this Mac is already paired, so it shows as a Use row with its tag.
    const choose = root.querySelector('[aria-label="Choose a Node"]')!
    expect(choose.textContent).not.toContain('This computer')
    expect(choose.querySelector('li')!.textContent).toContain('Node aOn this Mac')
    button(choose, 'Use')!.click()
    await settle()
    expect(root.querySelector('[aria-label="Home"]')).not.toBeNull()

    button(root.querySelector('header .menu-items')!, 'Forget Node a')!.click()
    await settle()
    expect(nodeChip(root)).toContain('No Node')
  })

  it('shows the install command with Copy, and carries on once the bridge answers', async () => {
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
    const banner = root.querySelector('[role="alert"]')!
    expect(banner.textContent).toContain('The Acorn browser bridge is not installed.')
    expect(banner.querySelector('code')!.textContent).toBe('acorn browser install')
    button(banner, 'Copy')!.click()
    expect(writeText).toHaveBeenCalledWith('acorn browser install')
    // The pairings are in the bridge, so Settings doesn't claim there are none.
    await openSettings(root)
    expect(root.textContent).not.toContain('No Node is paired')
    expect(root.textContent).toContain('The paired Nodes show once the bridge answers.')

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
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(root.querySelector('[aria-label="Choose a Node"]')).not.toBeNull()
  })
})
