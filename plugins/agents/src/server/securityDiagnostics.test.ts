import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentMcpServer } from '../shared/mcpServers'
import { defaultAgentSessionDefaults } from '../shared/sessionDefaults'
import { collectSecurityDiagnostics, readBoundedFile, securityScopeChoices, type SecurityDiagnosticPorts } from './securityDiagnostics'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; vi.useRealTimers() })

const ports = (overrides: Partial<SecurityDiagnosticPorts> = {}): SecurityDiagnosticPorts => ({
  core: {
    projects: { byId: async () => ({ id: 'project-1', path: root, name: 'project', workspaceId: 'workspace', github: null }) },
    tasks: { load: async () => ({ id: 'task-1', projectId: 'project-1' }) },
    fs: { resolveInRoot: (base: string, name: string) => resolve(base, name) },
    prefs: { read: async () => null },
    agentTools: { catalog: async () => [{ name: 'task_current', risk: 'read' }, { name: 'run_start', risk: 'execute' }] },
  } as never,
  defaults: async () => defaultAgentSessionDefaults(),
  managedMcp: async () => [],
  ...overrides,
})

it('names projects from their saved records', async () => {
  const projects = [
    { id: 'project-1', name: 'Acorn', path: '/projects/acorn' },
    { id: 'project-2', name: 'Runn', path: '/projects/runn' },
  ]
  const core = {
    projects: {
      checkouts: async () => [...projects, { id: 'removed', path: '/projects/removed' }],
      byId: async (id: string) => projects.find((project) => project.id === id) ?? null,
    },
  } as unknown as SecurityDiagnosticPorts['core']
  expect(await securityScopeChoices(core)).toEqual({ projects: [{ id: 'project-1', name: 'Acorn' }, { id: 'project-2', name: 'Runn' }] })
})

it('reports effective tool grants from saved preferences', async () => {
  const report = await collectSecurityDiagnostics(ports(), 'node-1', 'owner', {}, new AbortController().signal)
  expect(report.findings.find((finding) => finding.id === 'agent-tools.grants')?.summary).toContain('run_start denied')
  expect(report.findings.find((finding) => finding.id === 'agent-tools.grants')?.facts).toContainEqual({ label: 'Default: run commands', value: 'Blocked' })
  expect(report.findings.find((finding) => finding.id === 'agent-tools.grants')?.description).toContain('1 are allowed and 1 are blocked')
})

it('statically flags an unpinned runner and never returns credential-shaped inputs', async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-diagnostics-'))
  const secret = 'SyntheticSecretXYZ987'
  await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: `pnpm@${secret}`, scripts: { test: secret }, dependencies: { x: `https://example.test/?key=${secret}` } }))
  await writeFile(join(root, '.npmrc'), `registry=https://user:${secret}@example.test/?key=${secret}\n`)
  const server: AgentMcpServer = { name: secret, transport: 'stdio', command: 'npx', args: [secret], url: null,
    values: [{ name: 'TOKEN', value: secret, secret: false }], enabled: true, updatedAt: 0, revision: 'a'.repeat(64), consented: true, reviewTools: false, approvedCatalogueDigest: null }
  const http: AgentMcpServer = { name: 'remote', transport: 'http', command: null, args: [],
    url: `https://user:${secret}@example.test/path?token=${secret}`,
    values: [{ name: 'Authorization', value: secret, secret: false }], enabled: true, updatedAt: 0, revision: 'b'.repeat(64), consented: true, reviewTools: false, approvedCatalogueDigest: null }
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

it('reports timed-out reads as failed', async () => {
  vi.useFakeTimers()
  const pending = collectSecurityDiagnostics(ports({ defaults: async () => new Promise(() => undefined) }),
    'node-1', 'owner', {}, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(4_001)
  const timedOut = await pending
  expect(timedOut.findings.find((finding) => finding.id === 'instructions.checks')?.state).toBe('failed')
})

it('reports bounded plugin counts and observed admission without external text', async () => {
  const secret = 'SyntheticSecretXYZ987'
  const report = await collectSecurityDiagnostics(ports({
    core: { ...ports().core, pluginSecurity: { snapshot: async () => ({ packages: 2, executableGrants: 1, developmentEnabled: 1,
      skillsApproved: 1, skillsUnapproved: 2, pendingReview: 1 }) } } as never,
    instructionObservation: async () => ({ taskId: secret, projectId: 'project-1', checkedAt: 1234, outcome: 'blocked' }),
  }), 'node-1', 'owner', { projectId: 'project-1' }, new AbortController().signal)
  expect(report.findings.find((finding) => finding.id === 'plugins.grants')?.summary).toContain('1 active executable grants')
  expect(report.findings.filter((finding) => finding.id === 'plugins.grants')).toHaveLength(1)
  expect(report.findings.find((finding) => finding.id === 'plugins.grants')?.description).toContain('waiting for your review')
  expect(report.findings.find((finding) => finding.id === 'instructions.latest')).toMatchObject({ state: 'observed', severity: 'warning' })
  expect(JSON.stringify(report)).not.toContain(secret)
})

it('warns when the Node read its keys from files, or a plain key file is still in the data root', async () => {
  const keyFinding = async (snapshot: { delivery: 'desktop' | 'files'; keyCheck: 'ok' | 'none' | 'failed' | null; plainFiles: string[] }) =>
    (await collectSecurityDiagnostics(ports({ core: { ...ports().core, nodeKeys: { snapshot: () => snapshot } } as never }),
      'node-1', 'owner', {}, new AbortController().signal)).findings.find((finding) => finding.id === 'host.keys')
  expect(await keyFinding({ delivery: 'desktop', keyCheck: 'ok', plainFiles: [] })).toMatchObject({ state: 'observed', severity: 'info' })
  expect(await keyFinding({ delivery: 'desktop', keyCheck: 'failed', plainFiles: ['session.key'] })).toMatchObject({ severity: 'warning', repair: expect.stringContaining('Audit log') })
  expect(await keyFinding({ delivery: 'files', keyCheck: null, plainFiles: ['session.key', 'internal-token'] })).toMatchObject({ severity: 'warning' })
  expect((await collectSecurityDiagnostics(ports(), 'node-1', 'owner', {}, new AbortController().signal)).findings.some((finding) => finding.id === 'host.keys')).toBe(false)
})

it("says whether agents are kept out of Acorn's data folder", async () => {
  const finding = async (block: boolean) => (await collectSecurityDiagnostics(ports({
    defaults: async () => ({ ...defaultAgentSessionDefaults(), blockDataRootReads: block }),
    readBlockProviders: () => ['claude'],
  }), 'node-1', 'owner', {}, new AbortController().signal)).findings.find((item) => item.id === 'agents.read-block')
  expect(await finding(false)).toMatchObject({ severity: 'attention', summary: expect.stringContaining('disabled') })
  expect(await finding(true)).toMatchObject({ severity: 'info', summary: expect.stringContaining('harnesses that support it: claude') })
})

it('does not inspect encrypted approval bodies during a passive project check', async () => {
  const report = await collectSecurityDiagnostics(ports(), 'node-1', 'owner', { projectId: 'project-1' }, new AbortController().signal)
  expect(report.findings.find((finding) => finding.id === 'instructions.approval')).toMatchObject({ state: 'unknown' })
})

it('uses Changes static policy facts through the typed project capability', async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-diagnostics-'))
  const report = await collectSecurityDiagnostics(ports({
    staticDependencyPolicy: async () => ({ manager: 'pnpm', managerVersion: '11.0.0', policyKeys: ['pnpm-workspace.yaml:minimumReleaseAgeExclude', 'pnpm-workspace.yaml:allowBuilds'], releaseAgeMinutes: 1440, ignoreScripts: true, buildApprovalCount: 2, buildIgnoreCount: 1, allowAllBuilds: false, releaseAgeExceptionCount: 1, registryOrigins: ['https://registry.example'], sourcePolicyKeys: ['.npmrc:registry'], limits: [] }),
  }), 'node-1', 'owner', { projectId: 'project-1' }, new AbortController().signal)
  const finding = report.findings.find((item) => item.id === 'project.package-policy')
  expect(finding?.summary).toContain('minimumReleaseAgeExclude')
  expect(finding?.source).toContain('Changes static dependency policy capability')
  expect(finding?.summary).toContain('release age 1440 minutes')
  expect(finding?.summary).toContain('ignore scripts enabled')
  expect(finding?.facts).toContainEqual({ label: 'Wait before accepting a release', value: '1 day' })
})

it('bounds a stuck static policy capability and cancels a switched node check', async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-diagnostics-'))
  const stuck = ports({ staticDependencyPolicy: () => new Promise(() => {}) })
  vi.useFakeTimers()
  try {
    const pending = collectSecurityDiagnostics(stuck, 'node-1', 'owner', { projectId: 'project-1' }, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(4_100)
    const report = await pending
    expect(report.findings.find((finding) => finding.id === 'project.package-policy')?.state).toBe('failed')
  } finally { vi.useRealTimers() }
  const controller = new AbortController()
  const pending = collectSecurityDiagnostics(stuck, 'node-1', 'owner', { projectId: 'project-1' }, controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow('cancelled')
})

it('rejects a FIFO promptly and never emits configured policy evidence', async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-diagnostics-'))
  execFileSync('mkfifo', [join(root, 'package.json')])
  const report = await collectSecurityDiagnostics(ports(), 'node-1', 'owner', { projectId: 'project-1' }, new AbortController().signal)
  expect(report.findings.find((finding) => finding.id === 'project.package-policy')?.state).toBe('failed')
})

it('handles short reads and refuses growth beyond the limit', async () => {
  const content = Buffer.from('x'.repeat(32_769))
  const fake = { read: async (buffer: Buffer, _offset: number, length: number, position: number) => {
    const bytesRead = Math.min(7, length, content.length - position)
    content.copy(buffer, 0, position, position + bytesRead)
    return { bytesRead, buffer }
  } }
  await expect(readBoundedFile(fake as never, new AbortController().signal)).rejects.toThrow(/grew beyond limit/)
  const small = { read: async (buffer: Buffer, _offset: number, length: number, position: number) => {
    const bytesRead = Math.min(2, length, 5 - position)
    Buffer.from('hello').copy(buffer, 0, position, position + bytesRead)
    return { bytesRead, buffer }
  } }
  await expect(readBoundedFile(small as never, new AbortController().signal)).resolves.toBe('hello')
})
