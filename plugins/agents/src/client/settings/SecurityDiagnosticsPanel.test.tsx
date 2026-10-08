import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { SecurityDiagnostics, SecurityScopeChoices } from '../../shared/securityDiagnostics'

const mock = vi.hoisted(() => ({
  requests: [] as Array<{ route: string; nodeId?: string; signal?: AbortSignal; resolve(value: unknown): void }>,
}))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...(await original<typeof import('@acorn/plugin-api/client')>()),
  readJson: (route: string, options: { nodeId?: string; signal?: AbortSignal }) =>
    new Promise((resolve) => mock.requests.push({ route, nodeId: options.nodeId, signal: options.signal, resolve })),
}))
const { default: SecurityDiagnosticsPanel } = await import('./SecurityDiagnosticsPanel')

const choices: SecurityScopeChoices = { projects: [{ id: 'project-1', name: 'Project one' }, { id: 'project-2', name: 'Project two' }], sessions: [] }
const report = (nodeId: string, projectId: string | null = null): SecurityDiagnostics => ({
  nodeId, projectId, sessionId: null, checkedAt: Date.now(), expiresAt: Date.now() + 300_000,
  findings: [{ id: 'host.limit', owner: 'core', nodeId, projectId, sessionId: null, checkedAt: Date.now(),
    state: 'observed', severity: 'info', source: 'fixture', summary: `Evidence for ${nodeId}/${projectId ?? 'node'}`,
    limits: 'Limited evidence.', repair: 'Review settings.' }],
})
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const checkButton = (host: HTMLElement) => [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Check this node')!

afterEach(() => { mock.requests = [] })

it('cancels a Node request and ignores a late response from the previous Node', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const [nodeId, setNodeId] = createSignal('node-1')
  const dispose = render(() => <SecurityDiagnosticsPanel nodeId={nodeId()} />, host)
  mock.requests.shift()!.resolve(choices)
  await settle()
  checkButton(host).click()
  const old = mock.requests.shift()!
  expect(old.nodeId).toBe('node-1')
  setNodeId('node-2')
  expect(old.signal?.aborted).toBe(true)
  mock.requests.shift()!.resolve(choices)
  await settle()
  old.resolve(report('node-1'))
  await settle()
  expect(host.textContent).not.toContain('Evidence for node-1')
  checkButton(host).click()
  mock.requests.shift()!.resolve(report('node-2'))
  await settle()
  expect(host.textContent).toContain('Evidence for node-2')
  dispose(); host.remove()
})

it('clears project evidence when the project changes and refuses a late reply', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <SecurityDiagnosticsPanel nodeId="node-1" />, host)
  mock.requests.shift()!.resolve(choices)
  await settle()
  const project = [...host.querySelectorAll('select')].find((select) => select.getAttribute('aria-label') === 'Project') ?? host.querySelector('select')!
  project.value = 'project-1'; project.dispatchEvent(new Event('change', { bubbles: true }))
  checkButton(host).click()
  const old = mock.requests.shift()!
  project.value = 'project-2'; project.dispatchEvent(new Event('change', { bubbles: true }))
  expect(old.signal?.aborted).toBe(true)
  old.resolve(report('node-1', 'project-1'))
  await settle()
  expect(host.textContent).not.toContain('Evidence for node-1/project-1')
  dispose(); host.remove()
})
