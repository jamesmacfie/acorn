import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkedMcpPublication,
  exactMcpPackage,
  McpPackageInstaller,
  mcpFileDigest,
  mcpTreeDigest,
  type McpPackagePlan,
} from './mcpPackageInstall'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function staged(): Promise<{ installer: McpPackageInstaller; plan: McpPackagePlan; entry: string }> {
  const root = await mkdtemp(join(tmpdir(), 'acorn-managed-mcp-test-'))
  roots.push(root)
  const stagingPath = join(root, 'staging-fixture')
  const packageRoot = join(stagingPath, 'node_modules', '@fixture', 'server')
  await mkdir(packageRoot, { recursive: true })
  const entry = join(packageRoot, 'bin.mjs')
  await writeFile(entry, '#!/usr/bin/env node\nconsole.log("ready")\n')
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@fixture/server', version: '1.0.0', bin: { mcp: 'bin.mjs' } }),
  )
  const lockBytes = Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {} }))
  await writeFile(join(stagingPath, 'package-lock.json'), lockBytes)
  const plan: McpPackagePlan = {
    coordinate: { name: '@fixture/server', version: '1.0.0' },
    graph: [],
    bins: ['mcp'],
    lockDigest: createHash('sha256').update(lockBytes).digest('hex'),
    treeDigest: await mcpTreeDigest(stagingPath),
    registry: 'https://registry.npmjs.org/',
    runtime: process.version,
    policyVersion: 1,
    installer: process.execPath,
    exceptions: [],
    stagingPath,
  }
  return { installer: new McpPackageInstaller(root, process.execPath), plan, entry }
}

describe('exact managed MCP packages', () => {
  async function fakeNpm(childScript: boolean, recentChild: boolean, holdCi = false) {
    const root = await mkdtemp(join(tmpdir(), 'acorn-managed-npm-'))
    roots.push(root)
    const cli = join(root, 'npm-cli.js')
    const log = join(root, 'calls.txt')
    const canary = join(root, 'canary')
    const ciStarted = join(root, 'ci-started')
    await writeFile(
      cli,
      [
        `const fs = require('node:fs')`,
        `const path = require('node:path')`,
        `const log = ${JSON.stringify(log)}`,
        `fs.appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n')`,
        `const [action, name] = process.argv.slice(2)`,
        `const registry = 'https://registry.npmjs.org/'`,
        `if (action === 'install') fs.writeFileSync('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {`,
        `  '': { name: 'acorn-managed-mcp', version: '1.0.0' },`,
        `  'node_modules/fixture': { version: '1.0.0', integrity: 'sha512-fixture', resolved: registry + 'fixture/-/fixture-1.0.0.tgz' },`,
        `  'node_modules/child': { version: '1.0.0', integrity: 'sha512-child', resolved: registry + 'child/-/child-1.0.0.tgz', hasInstallScript: ${childScript} }`,
        `} }))`,
        `if (action === 'view') process.stdout.write(JSON.stringify(name === 'child' && ${recentChild} ? new Date().toISOString() : '2020-01-01T00:00:00.000Z'))`,
        `if (action === 'ci') {`,
        ...(holdCi ? [`  fs.writeFileSync(${JSON.stringify(ciStarted)}, '')`, `  setInterval(() => {}, 1000)`] : []),
        `  if (!process.argv.includes('--ignore-scripts')) fs.writeFileSync(${JSON.stringify(canary)}, 'ran')`,
        `  for (const name of ['fixture', 'child']) {`,
        `    const dir = path.join('node_modules', name); fs.mkdirSync(dir, { recursive: true })`,
        `    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...(name === 'fixture' ? { bin: { fixture: 'bin.mjs' } } : {}) }))`,
        `  }`,
        `  fs.writeFileSync('node_modules/fixture/bin.mjs', '#!/usr/bin/env node\\n')`,
        `}`,
      ].join('\n'),
    )
    return { root, cli, log, canary, ciStarted }
  }

  it('passes script suppression to resolution and frozen install without running a canary', async () => {
    const { root, cli, log, canary } = await fakeNpm(false, false)
    const installer = new McpPackageInstaller(join(root, 'installs'), cli)
    const plan = await installer.plan('fixture@1.0.0', [], new AbortController().signal)
    const calls = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[])
    expect(calls.filter(([action]) => action === 'install' || action === 'ci')).toEqual([
      expect.arrayContaining(['install', '--package-lock-only', '--ignore-scripts']),
      expect.arrayContaining(['ci', '--ignore-scripts']),
    ])
    await expect(readFile(canary)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(plan.graph.map((entry) => entry.name)).toEqual(['fixture', 'child'])
  })

  it('refuses a transitive script or recent transitive publication before frozen installation', async () => {
    for (const [script, recent, message] of [
      [true, false, 'install script'],
      [false, true, 'within seven days'],
    ] as const) {
      const { root, cli, log, canary } = await fakeNpm(script, recent)
      const installer = new McpPackageInstaller(join(root, 'installs'), cli)
      await expect(installer.plan('fixture@1.0.0', [], new AbortController().signal)).rejects.toThrow(message)
      const calls = (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
      expect(calls.some(([action]) => action === 'ci')).toBe(false)
      await expect(readFile(canary)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('uses npm ci as the archive integrity authority and rejects a tampered frozen lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'acorn-npm-integrity-'))
    roots.push(root)
    const source = join(root, 'source')
    const target = join(root, 'target')
    const canary = join(root, 'install-script-ran')
    await mkdir(source)
    await mkdir(target)
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { install: 'node install.js' } }),
    )
    await writeFile(join(source, 'index.js'), 'module.exports = true\n')
    await writeFile(join(source, 'install.js'), "require('node:fs').writeFileSync(process.env.CANARY_PATH, 'ran')\n")
    // The npm that ships beside the running Node. This tests npm's own integrity check, not
    // trustedNpmCli's ownership rules, which a CI runner's shared tool cache can fail.
    const npmPath =
      process.platform === 'win32'
        ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
        : join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const npm = (cwd: string, args: string[]) =>
      spawnSync(process.execPath, [npmPath, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: root,
          CANARY_PATH: canary,
          npm_config_cache: join(root, 'cache'),
          npm_config_update_notifier: 'false',
        },
      })
    expect(npm(source, ['pack', '--pack-destination', root, '--ignore-scripts', '--offline']).status).toBe(0)
    const archive = join(root, 'fixture-1.0.0.tgz')
    await writeFile(
      join(target, 'package.json'),
      JSON.stringify({ name: 'test-install', version: '1.0.0', dependencies: { fixture: `file:${archive}` } }),
    )
    expect(npm(target, ['install', '--package-lock-only', '--ignore-scripts', '--offline']).status).toBe(0)
    await expect(access(canary)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(npm(target, ['ci', '--ignore-scripts', '--offline']).status).toBe(0)
    await expect(access(canary)).rejects.toMatchObject({ code: 'ENOENT' })
    const lock = JSON.parse(await readFile(join(target, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { integrity?: string }>
    }
    lock.packages['node_modules/fixture']!.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`
    await writeFile(join(target, 'package-lock.json'), JSON.stringify(lock))
    const frozen = npm(target, ['ci', '--ignore-scripts', '--offline'])
    expect(frozen.status).not.toBe(0)
    expect(`${frozen.stdout}${frozen.stderr}`).toMatch(/integrity|checksum/i)
  })

  it('cancels frozen installation and removes its private staging tree', async () => {
    const { root, cli, ciStarted } = await fakeNpm(false, false, true)
    const installRoot = join(root, 'installs')
    const installer = new McpPackageInstaller(installRoot, cli)
    const controller = new AbortController()
    const plan = installer.plan('fixture@1.0.0', [], controller.signal)
    await vi.waitFor(() => expect(access(ciStarted)).resolves.toBeUndefined())
    controller.abort(new Error('device cancelled'))
    await expect(plan).rejects.toThrow('device cancelled')
    expect(await readdir(installRoot)).toEqual([])
  })
  it('accepts exact npm versions and refuses moving or non-registry sources', () => {
    expect(exactMcpPackage('@fixture/server@1.2.3')).toEqual({ name: '@fixture/server', version: '1.2.3' })
    for (const coordinate of [
      'server@latest',
      'server@^1.2.3',
      'server@1.2',
      'server@git+https://example.test/x',
      'https://example.test/x.tgz',
    ]) {
      expect(() => exactMcpPackage(coordinate)).toThrow('exact npm package')
    }
  })

  it('requires seven-day evidence across graph entries or an exact recorded exception', () => {
    const now = Date.parse('2026-10-08T00:00:00Z')
    const recent = '2026-10-07T00:00:00Z'
    expect(() => checkedMcpPublication('child@1.0.0', recent, undefined, now)).toThrow('within seven days')
    expect(() => checkedMcpPublication('child@1.0.0', undefined, undefined, now)).toThrow('No trustworthy')
    const exception = { coordinate: 'child@1.0.0', reason: 'Reviewed source archive', reviewedAt: now }
    expect(checkedMcpPublication('child@1.0.0', recent, exception, now)).toEqual({
      publishedAt: recent,
      usedException: true,
    })
    expect(checkedMcpPublication('child@1.0.0', '2026-09-01T00:00:00Z', undefined, now)).toEqual({
      publishedAt: '2026-09-01T00:00:00Z',
      usedException: false,
    })
  })

  it('activates a confined executable and records its bytes', async () => {
    const { installer, plan, entry } = await staged()
    const installed = await installer.activate(plan, 'mcp', new AbortController().signal)
    expect(installed.entry).toBe(join(installed.root, 'node_modules', '@fixture', 'server', 'bin.mjs'))
    expect(installed.entryDigest).toBe(
      createHash('sha256')
        .update(await readFile(entry.replace(plan.stagingPath, installed.root)))
        .digest('hex'),
    )
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
    await writeFile(
      join(plan.stagingPath, 'node_modules', '@fixture', 'server', 'package.json'),
      JSON.stringify({ name: '@fixture/server', version: '1.0.0', bin: { mcp: '../../../../outside.mjs' } }),
    )
    plan.treeDigest = await mcpTreeDigest(plan.stagingPath)
    await expect(installer.activate(plan, 'mcp', new AbortController().signal)).rejects.toThrow('escapes')
  })

  it('rejects a substituted FIFO before reading the staged lock or executable', async () => {
    const { installer, plan, entry } = await staged()
    const lock = join(plan.stagingPath, 'package-lock.json')
    await rm(lock)
    expect(spawnSync('mkfifo', [lock]).status).toBe(0)
    await expect(installer.preview(plan, 'mcp')).rejects.toThrow('bounded regular file')
    await rm(entry)
    expect(spawnSync('mkfifo', [entry]).status).toBe(0)
    await expect(mcpFileDigest(entry, 1024)).rejects.toThrow('bounded regular file')
    await expect(mcpTreeDigest(plan.stagingPath)).rejects.toThrow('special file')
  })

  it('stops an already-aborted read and preview before opening staged files', async () => {
    const { installer, plan, entry } = await staged()
    const controller = new AbortController()
    controller.abort(new Error('cancelled before read'))
    await expect(mcpFileDigest(entry, 1024, controller.signal)).rejects.toThrow('cancelled before read')
    await expect(installer.preview(plan, 'mcp', controller.signal)).rejects.toThrow('cancelled before read')
  })
})
