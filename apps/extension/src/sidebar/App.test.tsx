import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
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
function mount(known: string[], options: { refuseLateReads?: boolean } = {}) {
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
    const options = [...root.querySelectorAll('select[name="project"] option')].map((option) => option.textContent)
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

  it('shows the identity words before asking for a code, then pairs and selects', async () => {
    const { root } = mount([], { refuseLateReads: true })
    await settle()
    // With no Node paired, the line under the header leads to pairing in Settings.
    button(root, 'Pair a Node')!.click()
    await settle()
    type(input(root, 'address'), 'https://new.test:7443')
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(root.querySelector('[data-testid="identity-words"]')!.textContent).toBe(fingerprintPhrase(FINGERPRINT))
    expect(input(root, 'pairing-code')).toBeNull()

    input(root, 'confirm').click()
    await settle()
    type(input(root, 'pairing-code'), 'WRONG')
    root.querySelectorAll('form')[1]!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(root.textContent).toContain('Pairing failed. Check the code and try again.')

    type(input(root, 'pairing-code'), 'GOOD')
    root.querySelectorAll('form')[1]!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()
    expect(nodeChip(root)).toContain('Node new')
  })

  it('tells the person how to install a missing bridge', async () => {
    const fake = fakeBrowser()
    fake.onNativeConnect = (host) => host.close('Specified native messaging host not found.')
    startBackground(fake.api, 'com.acorn.browser_bridge')
    const root = document.createElement('div')
    document.body.append(root)
    dispose = render(() => <App api={fake.api} />, root)
    await settle()
    expect(root.querySelector('[role="alert"]')!.textContent).toContain('Run `acorn browser install`')
    // The pairings are in the bridge, so Settings doesn't claim there are none.
    await openSettings(root)
    expect(root.textContent).not.toContain('No Node is paired')
    expect(root.textContent).toContain('The paired Nodes show once the bridge answers.')
  })
})
