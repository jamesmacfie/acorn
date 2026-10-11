import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { SecurityDiagnostics, SecurityFinding } from '../../shared/securityDiagnostics'
import SecurityDiagnosticsResults from './SecurityDiagnosticsResults'

const events = vi.hoisted(() => ({ emit: vi.fn() }))
vi.mock('@acorn/plugin-api/client', async (original) => ({
  ...(await original<typeof import('@acorn/plugin-api/client')>()), clientEvents: events,
}))
const cleanup: Array<() => void> = []
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); events.emit.mockReset() })
const finding = (id: string, patch: Partial<SecurityFinding> = {}): SecurityFinding => ({
  id, owner: 'agents', nodeId: 'node-1', projectId: null, checkedAt: 1,
  state: 'configured_only', severity: 'info', summary: 'Technical evidence: fixture.raw', source: 'internal.fixture',
  limits: 'Evidence is limited.', repair: 'Review settings.', ...patch,
})
function mount(findings: SecurityFinding[], patch: Partial<SecurityDiagnostics> = {}) {
  const host = document.createElement('div'); document.body.append(host)
  const report: SecurityDiagnostics = { nodeId: 'node-1', projectId: null, checkedAt: 1, expiresAt: 300_001, findings, ...patch }
  const dispose = render(() => <SecurityDiagnosticsResults report={report} />, host)
  cleanup.push(() => { dispose(); host.remove() })
  return host
}

it('puts actionable warnings first and keeps technical evidence closed until requested', async () => {
  const host = mount([
    finding('instructions.checks', { description: 'Choose whether agents should wait for your approval.', facts: [{ label: 'Instruction changes', value: 'No approval required' }] }),
    finding('mcp.managed.example', { severity: 'warning', description: 'This server can download a different version each time it starts.' }),
    finding('plugins.grants', { state: 'unknown', severity: 'attention' }),
  ])
  expect(host.textContent!.indexOf('This server can download')).toBeLessThan(host.textContent!.indexOf('Choose whether agents'))
  expect(host.textContent).toContain('1 item needs your attention')
  expect(host.textContent).toContain('1 check could not be verified')
  expect(host.textContent).not.toContain('fixture.raw')
  expect(host.textContent).not.toContain('internal.fixture')
  expect(host.textContent).not.toContain('Acorn could not verify the permissions')
  const action = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Review MCP servers')!
  action.click()
  expect(events.emit).toHaveBeenCalledWith('presentation:open-settings', { tab: 'agent-mcp-servers' })
  const details = [...host.querySelectorAll('details')].find((element) => element.querySelector('summary')?.textContent === 'Technical details')!
  details.open = true; details.dispatchEvent(new Event('toggle'))
  await Promise.resolve()
  expect(host.textContent).toContain('fixture.raw')
})

it('omits the unselected project check and never calls unknown results safe', () => {
  const host = mount([
    finding('project.package-policy', { state: 'unknown' }),
    finding('plugins.grants', { state: 'unknown' }),
  ])
  expect(host.textContent).toContain('No project was included')
  expect(host.textContent).toContain('No settings could be verified')
  expect(host.textContent).not.toContain('No warnings were reported')
  expect(host.textContent).not.toContain('Package installation rules')
  expect(host.querySelectorAll('.ui-card')).toHaveLength(0)
})

it('shows failed reads as needing attention and supports reports from older Nodes', () => {
  const host = mount([finding('agent-tools.grants', { state: 'failed', severity: 'attention' })])
  expect(host.textContent).toContain('1 item needs your attention')
  expect(host.textContent).toContain('Check failed')
  expect(host.textContent).toContain('Acorn tool access')
  expect(host.textContent).toContain('Acorn could not check these settings')
  expect(host.textContent).toContain('Review tool permissions')
  expect(host.textContent).not.toContain('Technical evidence:')
})
