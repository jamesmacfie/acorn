import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants, type Stats } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readlink,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const REGISTRY = 'https://registry.npmjs.org/'
const AGE_MS = 7 * 24 * 60 * 60 * 1000
const DEADLINE_MS = 120_000
const MAX_OUTPUT = 32_768
const MAX_BYTES = 256 * 1024 * 1024
const MAX_FILES = 12_000
const MAX_ENTRIES = 20_000
const MAX_DEPTH = 32
const MAX_LOCK_BYTES = 4 * 1024 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_BIN_BYTES = 64 * 1024 * 1024
const EXACT = /^(?:@([a-z0-9][a-z0-9._-]*)\/)?([a-z0-9][a-z0-9._-]*)@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)$/

export type McpPackageCoordinate = { name: string; version: string }
export type McpPackageGraphEntry = {
  name: string
  version: string
  integrity: string
  resolved: string
  publishedAt: string
}
export type McpPublicationException = { coordinate: string; reason: string; reviewedAt: number }
export type McpPackagePlan = {
  coordinate: McpPackageCoordinate
  graph: McpPackageGraphEntry[]
  bins: string[]
  lockDigest: string
  treeDigest: string
  registry: typeof REGISTRY
  runtime: string
  policyVersion: 1
  installer: string
  exceptions: McpPublicationException[]
  stagingPath: string
}
export type McpInstalledPackage = Omit<McpPackagePlan, 'stagingPath'> & {
  root: string
  installationId: string
  bin: string
  entry: string
  entryDigest: string
}

/** Resolve an owner-installed npm CLI to a fixed absolute path before accepting install input. */
export async function trustedNpmCli(): Promise<string> {
  const dirs = [
    dirname(process.execPath),
    ...(process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':'),
    '/opt/homebrew/opt/node/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ]
  for (const dir of dirs) {
    if (!isAbsolute(dir)) continue
    for (const candidate of [
      join(dir, 'npm'),
      join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      join(dirname(dir), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]) {
      const actual = await realpath(candidate).catch(() => null)
      if (!actual || !actual.endsWith(`${sep}npm${sep}bin${sep}npm-cli.js`)) continue
      const file = await stat(actual).catch(() => null)
      if (!file?.isFile() || (process.platform !== 'win32' && (file.mode & 0o022) !== 0)) continue
      if (process.getuid && file.uid !== process.getuid() && file.uid !== 0) continue
      return actual
    }
  }
  throw new Error('Managed installation is unavailable: install npm in a trusted host Node location and restart Acorn.')
}

export function exactMcpPackage(input: string): McpPackageCoordinate {
  const match = EXACT.exec(input)
  if (!match)
    throw new Error(
      'Enter an exact npm package and version, such as @scope/server@1.2.3. Ranges, tags, Git, and archives are not accepted.',
    )
  return { name: match[1] ? `@${match[1]}/${match[2]}` : match[2]!, version: match[3]! }
}

export function checkedMcpPublication(
  key: string,
  published: string | undefined,
  exception: McpPublicationException | undefined,
  now = Date.now(),
): { publishedAt: string; usedException: boolean } {
  const timestamp = published ? Date.parse(published) : NaN
  if (!Number.isFinite(timestamp) || timestamp > now - AGE_MS) {
    if (!exception)
      throw new Error(
        !Number.isFinite(timestamp)
          ? `No trustworthy publication date for ${key}.`
          : `${key} was published within seven days.`,
      )
    return { publishedAt: Number.isFinite(timestamp) ? published! : 'unverified', usedException: true }
  }
  return { publishedAt: published!, usedException: false }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function sizeOfTree(root: string): Promise<void> {
  let files = 0
  let totalEntries = 0
  let bytes = 0
  const pending: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (pending.length) {
    const { dir, depth } = pending.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      if (++totalEntries > MAX_ENTRIES) throw new Error('The package exceeds the entry limit.')
      const path = join(dir, entry.name)
      const detail = await lstat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (!detail) continue // npm may rename a temporary cache entry while the monitor walks it.
      if (detail.isSymbolicLink()) continue
      if (detail.isDirectory()) {
        if (depth >= MAX_DEPTH) throw new Error('The package exceeds the directory depth limit.')
        pending.push({ dir: path, depth: depth + 1 })
      } else if (detail.isFile()) {
        files++
        bytes += detail.size
      } else throw new Error('The package created a special file.')
      if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error('The package exceeds the file or byte limit.')
    }
  }
}

export async function mcpTreeDigest(root: string, signal?: AbortSignal): Promise<string> {
  const canonicalRoot = await realpath(root)
  const digest = createHash('sha256')
  let files = 0
  let entries = 0
  let bytes = 0
  const walk = async (dir: string, depth: number) => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      signal?.throwIfAborted()
      if (++entries > MAX_ENTRIES) throw new Error('The package exceeds the entry limit.')
      const path = join(dir, entry.name)
      const detail = await lstat(path)
      const rel = relative(canonicalRoot, path)
      if (!inside(canonicalRoot, path)) throw new Error('An installed file escapes the private tree.')
      if (detail.isSymbolicLink()) {
        const target = await realpath(path)
        if (!inside(canonicalRoot, target)) throw new Error('An installed link escapes the private tree.')
        digest.update(JSON.stringify(['link', rel, await readlink(path)]))
      } else if (detail.isDirectory()) {
        if (depth >= MAX_DEPTH) throw new Error('The package exceeds the directory depth limit.')
        digest.update(JSON.stringify(['dir', rel]))
        await walk(path, depth + 1)
      } else if (detail.isFile()) {
        files++
        bytes += detail.size
        if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error('The package exceeds its file or byte limit.')
        digest.update(JSON.stringify(['file', rel, detail.size]))
        await scanRegularFile(path, MAX_BYTES - (bytes - detail.size), signal, (chunk) => digest.update(chunk), detail)
      } else throw new Error('The package contains a special file.')
    }
  }
  await walk(canonicalRoot, 0)
  return digest.digest('hex')
}

export async function mcpRuntimeIdentity(signal?: AbortSignal): Promise<string> {
  const runtimePath = await realpath(process.execPath)
  const executable = await stat(runtimePath)
  if (!executable.isFile() || executable.size > 300 * 1024 * 1024)
    throw new Error('The Node runtime is too large to verify.')
  return `${process.platform}/${process.arch}/${process.version}/${(await mcpFileDigest(runtimePath, 300 * 1024 * 1024, signal)).digest}`
}

/** Open before reading so a swapped FIFO, symlink, or special file cannot block on its first byte. */
async function scanRegularFile(
  path: string,
  limit: number,
  signal: AbortSignal | undefined,
  onChunk: (chunk: Buffer) => void,
  expected?: Stats,
): Promise<void> {
  signal?.throwIfAborted()
  if (!constants.O_NOFOLLOW)
    throw new Error('Managed MCP installation is unavailable: no-follow file opens are unsupported on this host.')
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
  try {
    signal?.throwIfAborted()
    const before = await handle.stat()
    if (
      !before.isFile() ||
      before.size > limit ||
      (expected && (before.dev !== expected.dev || before.ino !== expected.ino || before.size !== expected.size))
    ) {
      throw new Error('An MCP package file is not the expected bounded regular file.')
    }
    const deadline = AbortSignal.timeout(DEADLINE_MS)
    const readSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    let bytes = 0
    for await (const chunk of handle.createReadStream({ autoClose: false, signal: readSignal })) {
      bytes += chunk.byteLength
      if (bytes > limit || bytes > before.size) throw new Error('An MCP package file grew beyond its byte limit.')
      onChunk(chunk)
    }
    const after = await handle.stat()
    if (
      bytes !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error('An MCP package file changed while it was being verified.')
    }
  } finally {
    await handle.close()
  }
}

async function boundedFile(path: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = []
  await scanRegularFile(path, limit, signal, (chunk) => chunks.push(chunk))
  const bytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  return Buffer.concat(chunks, bytes)
}

export async function mcpFileDigest(
  path: string,
  limit: number,
  signal?: AbortSignal,
): Promise<{ digest: string; prefix: string }> {
  const hash = createHash('sha256')
  let prefix = Buffer.alloc(0)
  await scanRegularFile(path, limit, signal, (chunk) => {
    if (prefix.byteLength < 64) prefix = Buffer.concat([prefix, chunk.subarray(0, 64 - prefix.byteLength)])
    hash.update(chunk)
  })
  return { digest: hash.digest('hex'), prefix: prefix.toString('utf8') }
}

async function npm(npmPath: string, args: string[], cwd: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  if (!isAbsolute(npmPath) || !(await stat(npmPath).catch(() => null))?.isFile()) {
    throw new Error('Managed MCP installation is unavailable: the selected trusted npm executable is missing.')
  }
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('npm exceeded its two-minute deadline.')), DEADLINE_MS)
  let monitorWork: Promise<void> | null = null
  const monitor = setInterval(() => {
    if (monitorWork) return
    monitorWork = sizeOfTree(cwd)
      .catch((error) => controller.abort(error))
      .finally(() => {
        monitorWork = null
      })
  }, 500)
  let output = ''
  try {
    const child = spawn(
      npmPath.endsWith('.js') ? process.execPath : npmPath,
      npmPath.endsWith('.js') ? [npmPath, ...args] : args,
      {
        cwd,
        signal: controller.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: dirname(process.execPath),
          HOME: cwd,
          TMPDIR: cwd,
          npm_config_cache: join(cwd, '.npm-cache'),
          npm_config_ignore_scripts: 'true',
          npm_config_audit: 'false',
          npm_config_fund: 'false',
          npm_config_registry: REGISTRY,
          npm_config_update_notifier: 'false',
          npm_config_loglevel: 'error',
        },
      },
    )
    const add = (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (Buffer.byteLength(output) > MAX_OUTPUT) controller.abort(new Error('npm output exceeded its limit.'))
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const exit = await new Promise<number>((done, fail) => {
      child.once('error', (error) => fail(controller.signal.aborted ? controller.signal.reason : error))
      child.once('close', (code) => done(code ?? -1))
    })
    if (controller.signal.aborted) throw controller.signal.reason
    if (exit !== 0) throw new Error(`npm failed: ${output.slice(-2_000)}`)
    await sizeOfTree(cwd)
    if (controller.signal.aborted) throw controller.signal.reason
    return output
  } finally {
    clearTimeout(timer)
    clearInterval(monitor)
    if (monitorWork) await monitorWork
    signal.removeEventListener('abort', abort)
  }
}

type Lock = {
  packages?: Record<
    string,
    {
      name?: string
      version?: string
      integrity?: string
      resolved?: string
      optional?: boolean
      hasInstallScript?: boolean
    }
  >
}

function graphFromLock(lock: Lock): McpPackageGraphEntry[] {
  const entries = Object.entries(lock.packages ?? {}).filter(([path]) => path !== '')
  if (!entries.length || entries.length > 512) throw new Error('The package graph is empty or too large.')
  return entries.map(([path, data]) => {
    const name = data.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (data.hasInstallScript)
      throw new Error(
        `${name}@${data.version ?? '?'} declares an install script. Managed MCP runs no lifecycle scripts; choose a script-free package or use command mode.`,
      )
    if (
      !data.version ||
      !data.integrity ||
      !data.resolved ||
      !data.resolved.startsWith(REGISTRY) ||
      !data.integrity.startsWith('sha512-')
    ) {
      throw new Error(`The lockfile lacks a trusted registry origin or SHA-512 integrity for ${name}.`)
    }
    return { name, version: data.version, integrity: data.integrity, resolved: data.resolved, publishedAt: '' }
  })
}

async function verifyInstalledGraph(staging: string, lock: Lock, signal: AbortSignal): Promise<void> {
  const root = await realpath(staging)
  const packages = lock.packages ?? {}
  for (const [path, record] of Object.entries(packages)) {
    signal.throwIfAborted()
    if (!path) continue
    const location = resolve(root, path)
    if (!inside(root, location) || !path.includes('node_modules/'))
      throw new Error('The package lock names a path outside the installation.')
    const actual = await realpath(location).catch((error: NodeJS.ErrnoException) => {
      if (record.optional && error.code === 'ENOENT') return null
      throw error
    })
    if (!actual) continue
    if (!inside(root, actual)) throw new Error('An installed package escapes the private tree.')
    const manifest = JSON.parse(
      (await boundedFile(join(actual, 'package.json'), MAX_MANIFEST_BYTES, signal)).toString('utf8'),
    ) as { name?: string; version?: string }
    const expectedName = record.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (manifest.name !== expectedName || manifest.version !== record.version)
      throw new Error(`Installed package ${expectedName} differs from its frozen lock entry.`)
  }
}

function declaredBins(name: string, value: unknown): Record<string, string> {
  if (typeof value === 'string') return { [name.split('/').at(-1)!]: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  )
}

/** Only a device route calls this owner. Staging never becomes selected until activate succeeds. */
export class McpPackageInstaller {
  readonly #root: string
  readonly #npmPath: string
  #busy = false

  constructor(root: string, npmPath: string) {
    this.#root = root
    this.#npmPath = npmPath
  }

  async plan(
    input: string,
    exceptions: Array<{ coordinate: string; reason: string }>,
    signal: AbortSignal,
  ): Promise<McpPackagePlan> {
    if (this.#busy) throw new Error('Another MCP installation is running.')
    const coordinate = exactMcpPackage(input)
    if (exceptions.length > 8) throw new Error('At most eight exact publication exceptions are accepted.')
    const reviewedAt = Date.now()
    const exceptionsByCoordinate = new Map<string, McpPublicationException>()
    for (const exception of exceptions) {
      const exact = exactMcpPackage(exception.coordinate)
      if (!exception.reason.trim() || exception.reason.length > 500)
        throw new Error('Each publication exception needs a reason under 500 characters.')
      const key = `${exact.name}@${exact.version}`
      if (exceptionsByCoordinate.has(key)) throw new Error(`Duplicate publication exception: ${key}.`)
      exceptionsByCoordinate.set(key, { coordinate: key, reason: exception.reason.trim(), reviewedAt })
    }
    const failure = new AbortController()
    const activeSignal = AbortSignal.any([signal, AbortSignal.timeout(DEADLINE_MS), failure.signal])
    this.#busy = true
    let stagingPath = ''
    try {
      await mkdir(this.#root, { recursive: true, mode: 0o700 })
      stagingPath = await mkdtemp(join(this.#root, 'staging-'))
      await chmod(stagingPath, 0o700)
      await writeFile(
        join(stagingPath, 'package.json'),
        JSON.stringify({
          name: 'acorn-managed-mcp',
          private: true,
          version: '1.0.0',
          dependencies: { [coordinate.name]: coordinate.version },
        }),
        { mode: 0o600 },
      )
      const before = new Date(Date.now() - AGE_MS).toISOString()
      await npm(
        this.#npmPath,
        [
          'install',
          '--package-lock-only',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          ...(exceptions.length ? [] : [`--before=${before}`]),
        ],
        stagingPath,
        activeSignal,
      )
      const lockBytes = await boundedFile(join(stagingPath, 'package-lock.json'), MAX_LOCK_BYTES, activeSignal)
      const graph = graphFromLock(JSON.parse(lockBytes.toString('utf8')) as Lock)
      // npm's --before is a resolver filter, but the lock is the authority we activate. Check every
      // resolved version against the registry's publication record, including transitive copies.
      const usedExceptions = new Set<string>()
      let next = 0
      const inspect = async () => {
        while (next < graph.length) {
          activeSignal.throwIfAborted()
          const entry = graph[next++]!
          const key = `${entry.name}@${entry.version}`
          const exception = exceptionsByCoordinate.get(key)
          let published: string | undefined
          try {
            const answer = await npm(
              this.#npmPath,
              ['view', entry.name, `time[${entry.version}]`, '--json'],
              stagingPath,
              activeSignal,
            )
            const parsed: unknown = JSON.parse(answer)
            if (typeof parsed === 'string') published = parsed
          } catch (error) {
            if (!exception) {
              failure.abort(error)
              throw error
            }
          }
          try {
            const result = checkedMcpPublication(key, published, exception)
            if (result.usedException) usedExceptions.add(key)
            entry.publishedAt = result.publishedAt
          } catch (error) {
            failure.abort(error)
            throw error
          }
        }
      }
      const inspections = await Promise.allSettled(Array.from({ length: Math.min(4, graph.length) }, () => inspect()))
      const rejected = inspections.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (rejected) throw rejected.reason
      for (const key of exceptionsByCoordinate.keys())
        if (!usedExceptions.has(key)) throw new Error(`The exception for ${key} was not needed by this graph.`)
      await npm(this.#npmPath, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], stagingPath, activeSignal)
      if (
        createHash('sha256')
          .update(await boundedFile(join(stagingPath, 'package-lock.json'), MAX_LOCK_BYTES, activeSignal))
          .digest('hex') !== createHash('sha256').update(lockBytes).digest('hex')
      ) {
        throw new Error('The frozen package lock changed during installation.')
      }
      await verifyInstalledGraph(stagingPath, JSON.parse(lockBytes.toString('utf8')) as Lock, activeSignal)
      const packageRoot = join(stagingPath, 'node_modules', coordinate.name)
      const manifest = JSON.parse(
        (await boundedFile(join(packageRoot, 'package.json'), MAX_MANIFEST_BYTES, activeSignal)).toString('utf8'),
      ) as { name?: string; version?: string; bin?: unknown; scripts?: unknown }
      if (manifest.name !== coordinate.name || manifest.version !== coordinate.version)
        throw new Error('The installed package differs from the requested version.')
      const bins = declaredBins(coordinate.name, manifest.bin)
      if (!Object.keys(bins).length) throw new Error('This package declares no executable.')
      for (const path of Object.values(bins)) {
        const entry = resolve(packageRoot, path)
        if (!inside(packageRoot, entry) || !inside(await realpath(packageRoot), await realpath(entry)))
          throw new Error('The package executable escapes its installed tree.')
      }
      await rm(join(stagingPath, '.npm-cache'), { recursive: true, force: true })
      const treeDigest = await mcpTreeDigest(stagingPath, activeSignal)
      return {
        coordinate,
        graph,
        bins: Object.keys(bins).sort(),
        lockDigest: createHash('sha256').update(lockBytes).digest('hex'),
        treeDigest,
        registry: REGISTRY,
        runtime: await mcpRuntimeIdentity(activeSignal),
        policyVersion: 1,
        installer: this.#npmPath,
        exceptions: [...exceptionsByCoordinate.values()],
        stagingPath,
      }
    } catch (error) {
      if (stagingPath) await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
      throw error
    } finally {
      this.#busy = false
    }
  }

  async activate(plan: McpPackagePlan, bin: string, signal: AbortSignal): Promise<McpInstalledPackage> {
    signal.throwIfAborted()
    const { relativeEntry, entryDigest } = await this.preview(plan, bin, signal)
    signal.throwIfAborted()
    const installationId = randomUUID()
    const root = join(this.#root, `${plan.lockDigest}-${installationId}`)
    await rename(plan.stagingPath, root)
    return {
      coordinate: plan.coordinate,
      graph: plan.graph,
      bins: plan.bins,
      lockDigest: plan.lockDigest,
      treeDigest: plan.treeDigest,
      registry: plan.registry,
      runtime: plan.runtime,
      policyVersion: plan.policyVersion,
      installer: plan.installer,
      exceptions: plan.exceptions,
      root,
      installationId,
      bin,
      entry: join(root, relativeEntry),
      entryDigest,
    }
  }

  async preview(
    plan: McpPackagePlan,
    bin: string,
    signal?: AbortSignal,
  ): Promise<{ entry: string; relativeEntry: string; entryDigest: string }> {
    signal?.throwIfAborted()
    if (
      !plan.bins.includes(bin) ||
      !inside(this.#root, plan.stagingPath) ||
      !plan.stagingPath.startsWith(join(this.#root, 'staging-'))
    )
      throw new Error('The staged package or binary choice is invalid.')
    const packageRoot = join(plan.stagingPath, 'node_modules', plan.coordinate.name)
    const lockBytes = await boundedFile(join(plan.stagingPath, 'package-lock.json'), MAX_LOCK_BYTES, signal)
    if (createHash('sha256').update(lockBytes).digest('hex') !== plan.lockDigest)
      throw new Error('The staged lockfile changed before activation.')
    if ((await mcpTreeDigest(plan.stagingPath, signal)) !== plan.treeDigest)
      throw new Error('The staged package bytes changed after installation or test.')
    const manifest = JSON.parse(
      (await boundedFile(join(packageRoot, 'package.json'), MAX_MANIFEST_BYTES, signal)).toString('utf8'),
    ) as { bin?: unknown }
    const path = declaredBins(plan.coordinate.name, manifest.bin)[bin]
    if (!path) throw new Error('The selected executable disappeared.')
    if (!inside(packageRoot, resolve(packageRoot, path)))
      throw new Error('The executable escapes its installed package.')
    const stagingCanonical = await realpath(plan.stagingPath)
    const entry = await realpath(resolve(packageRoot, path))
    if (!inside(await realpath(packageRoot), entry)) throw new Error('The executable escapes its installed package.')
    const { digest: entryDigest, prefix } = await mcpFileDigest(entry, MAX_BIN_BYTES, signal)
    if (!prefix.startsWith('#!/usr/bin/env node') && !prefix.startsWith('#!/usr/bin/node')) {
      throw new Error(
        'The selected executable must be a Node script with a Node shebang. Install scripts are unavailable.',
      )
    }
    return { entry, relativeEntry: relative(stagingCanonical, entry), entryDigest }
  }

  async discard(plan: McpPackagePlan): Promise<void> {
    if (inside(this.#root, plan.stagingPath) && plan.stagingPath.startsWith(join(this.#root, 'staging-')))
      await rm(plan.stagingPath, { recursive: true, force: true })
  }

  async discardUnselected(installed: McpInstalledPackage): Promise<void> {
    if (
      !inside(this.#root, installed.root) ||
      installed.root !== join(this.#root, `${installed.lockDigest}-${installed.installationId}`)
    )
      return
    await sizeOfTree(installed.root)
    await rm(installed.root, { recursive: true, force: true })
  }

  async cleanOrphans(selected: ReadonlySet<string>): Promise<void> {
    let removed = 0
    let examined = 0
    const directory = await opendir(this.#root).catch(() => null)
    if (!directory) return
    for await (const entry of directory) {
      if (removed >= 8 || examined++ >= 64) break
      const path = join(this.#root, entry.name)
      if (!entry.isDirectory() || selected.has(path)) continue
      if (entry.name.startsWith('staging-') || /^[a-f0-9]{64}-[0-9a-f-]{36}$/.test(entry.name)) {
        if (Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000) {
          // A later mutation must not turn background cleanup into an unbounded tree walk.
          try {
            await sizeOfTree(path)
          } catch {
            continue
          }
          await rm(path, { recursive: true, force: true })
          removed++
        }
      }
    }
  }
}
