import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { git, gitOrThrow, resolveInRoot } from '@acorn/plugin-api/node'
import { parseDocument } from 'yaml'
import type { DependencyFinding, DependencyReview, LocalScope } from '../shared/api'
import type { StaticDependencyPolicy } from '@acorn/protocol/dependencyPolicy.ts'
import { isValidRelPath } from './localDiff'

const VERSION = 1
const MAX_FILE = 6 * 1024 * 1024
const MAX_TOTAL = 16 * 1024 * 1024
const MAX_PATHS = 5_000
const manifestName = (path: string) => path === 'package.json' || path.endsWith('/package.json')
const relevant = (path: string) => manifestName(path) || ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc', '.pnpmrc', '.pnpmfile.cjs', '.yarnrc', '.yarnrc.yml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'npm.config.js', 'requirements.txt', 'pyproject.toml', 'uv.lock', 'Pipfile.lock'].includes(path)
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const safe = (value: unknown): string => {
  if (Array.isArray(value)) return JSON.stringify(value.slice(0, 100).map((item) => safe(item))).slice(0, 400)
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.entries(record(value)).slice(0, 100).map(([key, item]) =>
    [safe(key), /auth|token|password|secret|key/i.test(key) ? '[redacted]' : safe(item)]))).slice(0, 400)
  const text = String(value)
  if (/^(?:git\+)?[a-z]+:\/\//i.test(text)) {
    try {
      const url = new URL(text.replace(/^git\+/, ''))
      const path = url.pathname === '/' ? '' : ` path:${digest(url.pathname).slice(0, 12)}`
      const revision = /^[#][0-9a-f]{7,64}$/i.test(url.hash) ? url.hash : url.hash ? `#${digest(url.hash).slice(0, 12)}` : ''
      return `${url.protocol}//${url.host}${path}${revision}`.slice(0, 400)
    } catch { return '[invalid URL]' }
  }
  if (/\$\{|\$\(|`/.test(text)) return '[dynamic value]'
  return text.slice(0, 400)
}
const yaml = (text: string): Record<string, unknown> => {
  const parsed = parseDocument(text, { uniqueKeys: true })
  if (parsed.errors.length) throw new Error('Malformed YAML')
  return record(parsed.toJS({ maxAliasCount: 0 }))
}
const json = (text: string): Record<string, unknown> => record(JSON.parse(text))

type FileSet = Map<string, string>
type Resolution = { name: string; identity: string; version: string; source: string; integrity: string | null; optional: boolean; path: string }
type Parsed = { manager: DependencyReview['manager']; version: string | null; resolutions: Map<string, Resolution>; direct: Map<string, string>; scripts: Map<string, string>; policy: Map<string, string>; importers: Set<string>; overrides: Set<string>; limits: string[] }
const empty = (): Parsed => ({ manager: 'unknown', version: null, resolutions: new Map(), direct: new Map(), scripts: new Map(), policy: new Map(), importers: new Set(), overrides: new Set(), limits: [] })
const addPolicy = (out: Parsed, path: string, name: string, value: unknown) => out.policy.set(`${path}:${safe(name)}`, safe(value))

function parseFiles(files: FileSet, readLimits: string[]): Parsed {
  const out = empty()
  out.limits.push(...readLimits)
  const root = files.get('package.json')
  let rootManifest: Record<string, unknown> = {}
  if (root) {
    try { rootManifest = json(root) } catch { out.limits.push('package.json is malformed.') }
  }
  const declared = typeof rootManifest.packageManager === 'string' ? rootManifest.packageManager.match(/^(npm|pnpm)@(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+sha\d+\.[0-9a-f]+)?)$/) : null
  const pnpm = files.has('pnpm-lock.yaml') || files.has('pnpm-workspace.yaml')
  const npm = files.has('package-lock.json') || files.has('npm-shrinkwrap.json')
  if (pnpm && npm) { out.manager = 'unsupported'; out.limits.push('Mixed npm and pnpm files; effective resolution is unknown.'); return out }
  out.manager = declared?.[1] as Parsed['manager'] ?? (pnpm ? 'pnpm' : npm ? 'npm' : 'unknown')
  out.version = declared?.[2] ?? null
  if ((declared?.[1] === 'pnpm' && npm) || (declared?.[1] === 'npm' && pnpm)) {
    out.manager = 'unsupported'
    out.limits.push('Package manager declaration and lockfile format disagree.')
    return out
  }
  if (rootManifest.packageManager && !declared) { out.manager = 'unsupported'; out.limits.push('Unsupported package manager declaration.'); return out }
  if (files.has('yarn.lock') || files.has('bun.lock') || files.has('bun.lockb')) { out.manager = 'unsupported'; out.limits.push('Yarn or Bun lockfile is unsupported.'); return out }
  if (out.manager === 'unknown' && ['requirements.txt', 'pyproject.toml', 'uv.lock', 'Pipfile.lock'].some((name) => files.has(name))) {
    out.manager = 'unsupported'; out.limits.push('Python dependency files are unsupported.'); return out
  }
  if (out.manager === 'unknown') out.limits.push('No supported package manager or lockfile found.')
  const lock = out.manager === 'pnpm' ? files.get('pnpm-lock.yaml') : out.manager === 'npm' ? files.get('npm-shrinkwrap.json') ?? files.get('package-lock.json') : undefined
  if (!lock && out.manager !== 'unknown') out.limits.push('Lockfile missing; installed resolutions are unknown.')

  for (const [path, text] of files) {
    if (path === '.pnpmfile.cjs' || path === 'npm.config.js') out.limits.push(`${path} is executable configuration and was not interpreted.`)
    else if (manifestName(path)) {
      try {
        const manifest = json(text)
        for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
          for (const [name, spec] of Object.entries(record(manifest[group]))) out.direct.set(`${path}:${group}:${name}`, safe(spec))
        }
        for (const name of Object.keys(record(manifest.scripts)).filter((name) => /^(preinstall|install|postinstall|prepare|prepublish|prepack|postpack)$/.test(name))) out.scripts.set(`${path}:${name}`, 'declared')
        if (path === 'package.json') {
          for (const key of ['packageManager', 'engines', 'overrides', 'resolutions']) if (key in manifest) addPolicy(out, path, key, manifest[key])
          for (const [key, value] of Object.entries(record(manifest.pnpm))) if (/build|overrides|age|registry|trust/i.test(key)) addPolicy(out, path, `pnpm.${key}`, value)
        }
      } catch { out.limits.push(`${path} is malformed.`) }
    } else if (path === 'pnpm-workspace.yaml' || path === '.yarnrc.yml') {
      try {
        const config = yaml(text)
        for (const [key, value] of Object.entries(config)) if (/age|build|catalog|overrides|registry|trust|package/i.test(key)) addPolicy(out, path, key, value)
      } catch { out.limits.push(`${path} is malformed.`) }
    } else if (path === '.npmrc' || path === '.pnpmrc' || path === '.yarnrc') {
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([^=\s]+)\s*=\s*([^#\r\n]+)/)
        if (!match) continue
        const [, key, value] = match
        if (key === 'registry' || key!.startsWith('@') && key!.endsWith(':registry')) addPolicy(out, path, key!, value)
        else if (/^(ignore-scripts|minimum-release-age|strict-ssl|engine-strict)$/.test(key!)) addPolicy(out, path, key!, /^(true|false|\d+)$/i.test(value!.trim()) ? value!.trim() : '[uninterpreted]')
      }
      if (/\$\{|\$\(|`/.test(text)) out.limits.push(`${path} contains dynamic values; they were not evaluated.`)
    }
  }
  if (!lock) return out
  try {
    if (out.manager === 'npm') parseNpm(out, json(lock), files.has('npm-shrinkwrap.json') ? 'npm-shrinkwrap.json' : 'package-lock.json')
    if (out.manager === 'pnpm') parsePnpm(out, yaml(lock))
  } catch { out.limits.push('Lockfile is malformed or unsupported; installed resolutions are unknown.'); out.resolutions.clear() }
  if (!out.limits.some((limit) => /Lockfile is malformed|Unsupported .* lockfile/.test(limit))) {
    for (const [key, spec] of out.direct) {
      if (key.includes(':lock ') || key.includes(':resolved ')) continue
      const [path, group, name] = key.split(':')
      if (!out.importers.has(path!) || group === 'peerDependencies') continue
      const lockSpec = out.direct.get(key.replace(/:(dependencies|devDependencies|optionalDependencies|peerDependencies):/, ':lock $1:'))
      if (lockSpec === undefined) {
        if (!['dependencies', 'devDependencies', 'optionalDependencies'].some((other) =>
          out.direct.has(`${path}:lock ${other}:${name}`))) out.limits.push(`${key}: lockfile resolution is missing.`)
      } else if (lockSpec !== spec && !spec.startsWith('catalog:') && !out.overrides.has(name!)) out.limits.push(`${key}: manifest and lockfile specifiers disagree.`)
    }
  }
  return out
}

function parseNpm(out: Parsed, lock: Record<string, unknown>, lockPath: string) {
  if (![2, 3].includes(Number(lock.lockfileVersion))) { out.limits.push('Unsupported npm lockfile version.'); return }
  const packages = record(lock.packages)
  if (!Object.keys(packages).length) { out.limits.push('npm packages table missing.'); return }
  out.importers.add('package.json')
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(record(record(packages[''])[group]))) out.direct.set(`package.json:lock ${group}:${name}`, safe(spec))
  }
  for (const [path, raw] of Object.entries(packages)) {
    if (!path) continue
    const item = record(raw)
    const name = typeof item.name === 'string' ? item.name : path.split('node_modules/').at(-1)!
    const version = safe(item.version ?? 'unknown')
    const source = safe(item.resolved ?? (item.link ? 'workspace link' : 'unreported'))
    out.resolutions.set(path, { name, identity: path, version, source, integrity: typeof item.integrity === 'string' ? safe(item.integrity) : null, optional: item.optional === true, path: lockPath })
  }
}

function parsePnpm(out: Parsed, lock: Record<string, unknown>) {
  if (!String(lock.lockfileVersion).startsWith('9.')) { out.limits.push('Unsupported pnpm lockfile version.'); return }
  if (!Object.keys(record(lock.importers)).length) { out.limits.push('pnpm importers table missing.'); return }
  for (const key of Object.keys(record(lock.overrides))) out.overrides.add(key)
  for (const [key, raw] of Object.entries(record(lock.packages))) {
    const item = record(raw)
    const resolution = record(item.resolution)
    const split = key.lastIndexOf('@')
    const name = split > 0 ? key.slice(0, split) : key
    const version = split > 0 ? safe(key.slice(split + 1)) : 'unknown'
    out.resolutions.set(key, { name, identity: key, version, source: safe(resolution.tarball ?? resolution.repo ?? resolution.type ?? 'registry'), integrity: typeof resolution.integrity === 'string' ? safe(resolution.integrity) : null, optional: item.optional === true, path: 'pnpm-lock.yaml' })
  }
  // Snapshot keys preserve peer context and patched variants. A package table entry may be shared by
  // several snapshots, so keep the snapshot identity as well when it differs.
  for (const [key, raw] of Object.entries(record(lock.snapshots))) {
    if (out.resolutions.has(key)) continue
    const base = key.replace(/\(.+$/, '')
    const parent = out.resolutions.get(base)
    if (parent) out.resolutions.set(key, { ...parent, identity: key, optional: record(raw).optional === true || parent.optional })
    else {
      const item = record(raw)
      out.resolutions.set(key, { name: key.slice(0, key.lastIndexOf('@')), identity: key, version: safe(key.slice(key.lastIndexOf('@') + 1)), source: 'unreported', integrity: null, optional: item.optional === true, path: 'pnpm-lock.yaml' })
    }
  }
  for (const [importer, raw] of Object.entries(record(lock.importers))) {
    out.importers.add(importer === '.' ? 'package.json' : `${importer}/package.json`)
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, entry] of Object.entries(record(record(raw)[group]))) {
        const item = record(entry)
        const path = importer === '.' ? 'package.json' : `${importer}/package.json`
        out.direct.set(`${path}:lock ${group}:${name}`, safe(item.specifier ?? 'unknown'))
        out.direct.set(`${path}:resolved ${group}:${name}`, safe(item.version ?? 'unknown'))
      }
    }
  }
}

function compare(before: Parsed, after: Parsed): DependencyFinding[] {
  const findings: DependencyFinding[] = []
  const diff = (a: Map<string, string>, b: Map<string, string>, kind: DependencyFinding['kind']) => {
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const old = a.get(key) ?? null, next = b.get(key) ?? null
      if (old !== next) findings.push({ path: key.slice(0, key.indexOf(':')), kind, name: key.slice(key.indexOf(':') + 1), before: old, after: next,
        warning: kind === 'policy' && /age|build|registry|override|trust|ignore-scripts/i.test(key) || kind === 'script' && next !== null })
    }
  }
  diff(before.direct, after.direct, 'direct')
  diff(before.scripts, after.scripts, 'script')
  diff(before.policy, after.policy, 'policy')
  if (before.version !== after.version) findings.push({ path: 'package.json', kind: 'policy', name: 'package manager version', before: before.version, after: after.version })
  const keys = new Set([...before.resolutions.keys(), ...after.resolutions.keys()])
  for (const key of keys) {
    const old = before.resolutions.get(key), next = after.resolutions.get(key)
    const name = safe(next?.name ?? old?.name ?? key)
    const path = next?.path ?? old?.path ?? 'package-lock.json'
    if (!old || !next) {
      findings.push({ path, kind: 'transitive', name, before: old?.version ?? null, after: next?.version ?? null, detail: safe(key) })
      findings.push({ path, kind: 'source', name, before: old?.source ?? null, after: next?.source ?? null, detail: safe(key) })
      if (old?.integrity || next?.integrity) findings.push({ path, kind: 'integrity', name, before: old?.integrity ?? null, after: next?.integrity ?? null, detail: safe(key) })
      else if (next) findings.push({ path, kind: 'integrity', name, before: null, after: null, detail: `${safe(key)}: lockfile entry has no integrity metadata` })
    } else {
      if (old.version !== next.version) findings.push({ path, kind: 'transitive', name, before: old.version, after: next.version, detail: safe(key) })
      if (old.source !== next.source) findings.push({ path, kind: 'source', name, before: old.source, after: next.source, detail: safe(key) })
      if (old.integrity !== next.integrity) findings.push({ path, kind: 'integrity', name, before: old.integrity, after: next.integrity, detail: safe(key) })
      if (old.optional !== next.optional) findings.push({ path, kind: 'transitive', name, before: `optional=${old.optional}`, after: `optional=${next.optional}`, detail: safe(key) })
    }
  }
  if (findings.length > 1_000) after.limits.push('More than 1,000 dependency findings; the list was truncated.')
  return findings.slice(0, 1_000)
}

async function paths(root: string, scope: LocalScope): Promise<string[]> {
  const [head, present] = await Promise.all([
    git(['ls-tree', '-r', '--name-only', '-z', 'HEAD'], { cwd: root, maxOutputBytes: 2 * 1024 * 1024 }),
    gitOrThrow(['ls-files', '-z', '--cached', ...(scope === 'unstaged' ? ['--others', '--exclude-standard'] : [])], { cwd: root, maxOutputBytes: 2 * 1024 * 1024 }),
  ])
  const found = [...new Set([head.code === 0 ? head.stdout : '', present.stdout].flatMap((output) => output.split('\0')).filter((path) => isValidRelPath(path) && relevant(path)))]
  if (found.length > MAX_PATHS) throw new Error('Too many dependency files.')
  return found
}

async function gitBlob(root: string, revision: 'HEAD' | 'index', path: string): Promise<string | null> {
  const ref = revision === 'HEAD' ? `HEAD:${path}` : `:${path}`
  const result = await git(['cat-file', 'blob', ref], { cwd: root, maxOutputBytes: MAX_FILE + 1, timeoutMs: 15_000 })
  return result.code === 0 ? result.stdout : null
}

async function diskFile(root: string, path: string): Promise<string | null> {
  const absolute = resolveInRoot(root, path)
  if (!absolute) throw new Error('Path escapes worktree.')
  // Refuse a leaf symlink, even when it points inside the worktree.
  let file
  try { file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_FILE) throw new Error('Dependency file is not regular or exceeds 6 MiB.')
    const chunks: Buffer[] = []
    let offset = 0
    while (true) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, MAX_FILE + 1 - offset))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      if (!bytesRead) break
      offset += bytesRead
      if (offset > MAX_FILE) throw new Error('Dependency file grew beyond 6 MiB.')
      chunks.push(buffer.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { await file.close() }
}

async function snapshot(root: string, scope: LocalScope, side: 'before' | 'after'): Promise<{ files: FileSet; limits: string[] }> {
  const files: FileSet = new Map(), limits: string[] = []
  let total = 0
  let candidates: string[]
  try { candidates = await paths(root, scope) }
  catch { return { files, limits: ['Dependency path listing failed or exceeded its 2 MiB and 5,000-file bounds.'] } }
  for (const path of candidates) {
    try {
      const value = scope === 'staged' ? await gitBlob(root, side === 'before' ? 'HEAD' : 'index', path)
        : side === 'before' ? await gitBlob(root, 'index', path) : await diskFile(root, path)
      if (value === null) continue
      total += Buffer.byteLength(value)
      if (total > MAX_TOTAL) { limits.push('Dependency files exceed the 16 MiB review budget.'); break }
      files.set(path, value)
    } catch { limits.push(`${path}: unreadable, unsafe, or oversized.`) }
  }
  return { files, limits }
}

export async function dependencyReview(root: string, scope: LocalScope, taskId = root): Promise<DependencyReview> {
  const canonical = await realpath(root)
  const [old, next] = await Promise.all([snapshot(canonical, scope, 'before'), snapshot(canonical, scope, 'after')])
  const before = parseFiles(old.files, old.limits), after = parseFiles(next.files, next.limits)
  const revision = digest(JSON.stringify([taskId, canonical, scope, after.manager, [...old.files].map(([path, value]) => [path, digest(value)]),
    [...next.files].map(([path, value]) => [path, digest(value)]), old.limits, next.limits, VERSION]))
  const findings = compare(before, after)
  const packageCount = new Set(findings.filter((finding) => ['direct', 'transitive', 'source', 'integrity'].includes(finding.kind))
    .map((finding) => finding.kind === 'direct' ? finding.name.split(':').at(-1)! : finding.name)).size
  const limits = [...new Set([...before.limits, ...after.limits, 'Installed dependency scripts, release dates, provenance, and malware status are unknown from repository files.'])]
  return { scope, revision: `sha256:${revision}`, analyzerVersion: VERSION, manager: after.manager, managerVersion: after.version,
    coverage: after.manager === 'unsupported' ? 'unsupported' : limits.length > 1 || after.manager === 'unknown' ? 'partial' : 'complete', packageCount, findings, limits }
}

export async function staticDependencyPolicy(root: string): Promise<StaticDependencyPolicy> {
  const canonical = await realpath(root)
  const files: FileSet = new Map(), limits: string[] = []
  for (const name of ['package.json', 'pnpm-workspace.yaml', '.npmrc', '.pnpmrc', '.pnpmfile.cjs', 'npm.config.js', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml']) {
    try {
      // The lockfile's presence identifies the manager. Its contents are not needed by this summary.
      const content = await diskFile(canonical, name)
      if (content !== null) files.set(name,
        name === 'pnpm-lock.yaml' ? 'lockfileVersion: 9.0\nimporters:\n  .: {}\n' :
          name.endsWith('lock.json') ? '{"lockfileVersion":3,"packages":{"":{}}}' : content)
    } catch { limits.push(`${name}: unreadable, unsafe, or oversized.`) }
  }
  const parsed = parseFiles(files, limits)
  return { manager: parsed.manager, managerVersion: parsed.version, policyKeys: [...parsed.policy.keys()].slice(0, 100), limits: parsed.limits }
}
