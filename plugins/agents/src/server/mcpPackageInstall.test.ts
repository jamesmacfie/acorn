import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkedMcpPublication, exactMcpPackage, McpPackageInstaller, mcpTreeDigest, type McpPackagePlan } from './mcpPackageInstall'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function staged(): Promise<{ installer: McpPackageInstaller; plan: McpPackagePlan; entry: string }> {
  const root = await mkdtemp(join(tmpdir(), 'acorn-managed-mcp-test-'))
  roots.push(root)
  const stagingPath = join(root, 'staging-fixture')
  const packageRoot = join(stagingPath, 'node_modules', '@fixture', 'server')
  await mkdir(packageRoot, { recursive: true })
  const entry = join(packageRoot, 'bin.mjs')
  await writeFile(entry, '#!/usr/bin/env node\nconsole.log("ready")\n')
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: '@fixture/server', version: '1.0.0', bin: { mcp: 'bin.mjs' } }))
  const lockBytes = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {} }))
  await writeFile(join(stagingPath, 'package-lock.json'), lockBytes)
  const plan: McpPackagePlan = {
    coordinate: { name: '@fixture/server', version: '1.0.0' }, graph: [], bins: ['mcp'],
    lockDigest: createHash('sha256').update(lockBytes).digest('hex'), treeDigest: await mcpTreeDigest(stagingPath), registry: 'https://registry.npmjs.org/',
    runtime: process.version, policyVersion: 1, installer: process.execPath, exceptions: [], stagingPath,
  }
  return { installer: new McpPackageInstaller(root, process.execPath), plan, entry }
}

describe('exact managed MCP packages', () => {
  it('accepts exact npm versions and refuses moving or non-registry sources', () => {
    expect(exactMcpPackage('@fixture/server@1.2.3')).toEqual({ name: '@fixture/server', version: '1.2.3' })
    for (const coordinate of ['server@latest', 'server@^1.2.3', 'server@1.2', 'server@git+https://example.test/x', 'https://example.test/x.tgz']) {
      expect(() => exactMcpPackage(coordinate)).toThrow('exact npm package')
    }
  })

  it('requires seven-day evidence across graph entries or an exact recorded exception', () => {
    const now = Date.parse('2026-10-08T00:00:00Z')
    const recent = '2026-10-07T00:00:00Z'
    expect(() => checkedMcpPublication('child@1.0.0', recent, undefined, now)).toThrow('within seven days')
    expect(() => checkedMcpPublication('child@1.0.0', undefined, undefined, now)).toThrow('No trustworthy')
    const exception = { coordinate: 'child@1.0.0', reason: 'Reviewed source archive', reviewedAt: now }
    expect(checkedMcpPublication('child@1.0.0', recent, exception, now)).toEqual({ publishedAt: recent, usedException: true })
    expect(checkedMcpPublication('child@1.0.0', '2026-09-01T00:00:00Z', undefined, now)).toEqual({ publishedAt: '2026-09-01T00:00:00Z', usedException: false })
  })

  it('activates a confined executable and records its bytes', async () => {
    const { installer, plan, entry } = await staged()
    const installed = await installer.activate(plan, 'mcp', new AbortController().signal)
    expect(installed.entry).toBe(join(installed.root, 'node_modules', '@fixture', 'server', 'bin.mjs'))
    expect(installed.entryDigest).toBe(createHash('sha256').update(await readFile(entry.replace(plan.stagingPath, installed.root))).digest('hex'))
  })

  it('refuses a changed lock or cancellation before replacing selection', async () => {
    const { installer, plan } = await staged()
    await writeFile(join(plan.stagingPath, 'package-lock.json'), '{}')
    await expect(installer.activate(plan, 'mcp', new AbortController().signal)).rejects.toThrow('lockfile changed')
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(installer.activate(plan, 'mcp', controller.signal)).rejects.toThrow('cancelled')
  })

  it('refuses a binary symlink outside the installed package', async () => {
    const { installer, plan } = await staged()
    await writeFile(join(plan.stagingPath, 'node_modules', '@fixture', 'server', 'package.json'), JSON.stringify({ name: '@fixture/server', version: '1.0.0', bin: { mcp: '../../../../outside.mjs' } }))
    plan.treeDigest = await mcpTreeDigest(plan.stagingPath)
    await expect(installer.activate(plan, 'mcp', new AbortController().signal)).rejects.toThrow('escapes')
  })
})
