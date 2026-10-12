import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import { fingerprintPhrase } from '@acorn/protocol/fingerprintWords.ts'
import { startBackground } from '../background/background'
import { fakeBrowser, settle, type FakeHost } from '../test/fakeBrowser'
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

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)!
const input = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!
const type = (element: HTMLInputElement, value: string) => {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('sidebar', () => {
  it('keeps the selected Node projects when an earlier Node answers late', async () => {
    const { held, root } = mount(['a', 'b'])
    await settle()
    button(root, 'Use').click()
    await settle()
    expect(held.map((read) => read.nodeId)).toEqual(['a'])
    // Switch to b while a's read is still out, then let both answer, b first.
    button(root, 'Use').click()
    await settle()
    held[1]!.release()
    held[0]!.release()
    await settle()
    expect(root.querySelector('[aria-label="Selected Node"]')!.textContent).toContain('Node b')
    const options = [...root.querySelectorAll('select[name="project"] option')].map((option) => option.textContent)
    expect(options).toEqual(['Choose a project', 'b project'])
  })

  it('shows the identity words before asking for a code, then pairs and selects', async () => {
    const { root } = mount([], { refuseLateReads: true })
    await settle()
    button(root, 'Pair a Node').click()
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
    expect(root.querySelector('[aria-label="Selected Node"]')!.textContent).toContain('Node new')
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
  })
})
