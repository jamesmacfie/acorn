import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentSession } from '../contract/wire.ts'
import type { AgentMcpServer } from '../shared/mcpServers'
import { defaultAgentSessionDefaults } from '../shared/sessionDefaults'
import { collectSecurityDiagnostics, type SecurityDiagnosticPorts } from './securityDiagnostics'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; vi.useRealTimers() })

const session = (config: Record<string, unknown>): AgentSession => ({
  id: 'session-1', taskId: 'task-1', providerId: 'codex', profileId: 'codex', driverKind: 'codex-app-server',
  driverVersion: '1', runtimeState: 'ready', archivedAt: null, config,
} as AgentSession)
const ports = (overrides: Partial<SecurityDiagnosticPorts> = {}): SecurityDiagnosticPorts => ({
  core: {
    projects: { byId: async () => ({ id: 'project-1', path: root, name: 'project', workspaceId: 'workspace', github: null }) },
    tasks: { load: async () => ({ id: 'task-1', projectId: 'project-1' }) },
    fs: { resolveInRoot: (base: string, name: string) => resolve(base, name) },
    prefs: { read: async () => null },
    agentTools: { catalog: async () => [{ name: 'task_current', risk: 'read' }, { name: 'run_start', risk: 'execute' }] },
  } as never,
  defaults: async () => defaultAgentSessionDefaults(),
  session: async () => null,
  managedMcp: async () => [],
  ...overrides,
})

it('uses the live permission profile and narrower ceiling while describing defaults separately', async () => {
  const current = session({ configOptions: [{ id: 'permissions', category: 'permission', currentValue: 'workspace-write' }], toolCeiling: { maxRisk: 'read' } })
  const report = await collectSecurityDiagnostics(ports({
    defaults: async () => ({ ...defaultAgentSessionDefaults(), followLastSession: false, checkInstructionFiles: true,
      pinned: { codex: { permissions: 'danger-full-access' } } }),
    session: async () => current,
  }), 'node-1', 'owner', { sessionId: current.id }, new AbortController().signal)
  expect(report.findings.find((finding) => finding.id === 'harness.permission-profile')).toMatchObject({ state: 'observed', summary: 'Current session permission profile: workspace-write.' })
  expect(report.findings.find((finding) => finding.id === 'harness.next-default')?.summary).toContain('danger-full-access')
  expect(report.findings.find((finding) => finding.id === 'agent-tools.grants')?.summary).toContain('run_start denied')
  expect(report.findings.find((finding) => finding.id === 'agent-tools.ceiling')?.summary).toContain('read')
})

it('statically flags an unpinned runner and never returns credential-shaped inputs', async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-diagnostics-'))
  const secret = 'SyntheticSecretXYZ987'
  await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: `pnpm@${secret}`, scripts: { test: secret }, dependencies: { x: `https://example.test/?key=${secret}` } }))
  await writeFile(join(root, '.npmrc'), `registry=https://user:${secret}@example.test/?key=${secret}\n`)
  const server: AgentMcpServer = { name: secret, transport: 'stdio', command: 'npx', args: [secret], url: null,
    values: [{ name: 'TOKEN', value: secret, secret: false }], enabled: true, updatedAt: 0 }
  const http: AgentMcpServer = { name: 'remote', transport: 'http', command: null, args: [],
    url: `https://user:${secret}@example.test/path?token=${secret}`,
    values: [{ name: 'Authorization', value: secret, secret: false }], enabled: true, updatedAt: 0 }
  const report = await collectSecurityDiagnostics(ports({ managedMcp: async () => [server, http] }),
    'node-1', 'owner', { projectId: 'project-1' }, new AbortController().signal)
  expect(report.findings.find((finding) => finding.id.startsWith('mcp.managed.'))).toMatchObject({ severity: 'warning' })
  expect(JSON.stringify(report)).not.toContain(secret)
})

it('refuses a policy file symlink outside the canonical project root', async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-diagnostics-'))
  const outside = await mkdtemp(join(tmpdir(), 'acorn-diagnostics-outside-'))
  try {
    await writeFile(join(outside, 'package.json'), JSON.stringify({ packageManager: 'npm@1.2.3' }))
    await symlink(join(outside, 'package.json'), join(root, 'package.json'))
    const report = await collectSecurityDiagnostics(ports(), 'node-1', 'owner', { projectId: 'project-1' }, new AbortController().signal)
    expect(report.findings.find((finding) => finding.id === 'project.package-policy')?.state).toBe('failed')
  } finally { await rm(outside, { recursive: true, force: true }) }
})

it('reports missing metadata as unknown and timed-out reads as failed', async () => {
  const noSession = await collectSecurityDiagnostics(ports(), 'node-1', 'owner', {}, new AbortController().signal)
  expect(noSession.findings.find((finding) => finding.id === 'harness.identity')?.state).toBe('unknown')
  vi.useFakeTimers()
  const pending = collectSecurityDiagnostics(ports({ defaults: async () => new Promise(() => undefined) }),
    'node-1', 'owner', {}, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(4_001)
  const timedOut = await pending
  expect(timedOut.findings.find((finding) => finding.id === 'instructions.checks')?.state).toBe('failed')
})
