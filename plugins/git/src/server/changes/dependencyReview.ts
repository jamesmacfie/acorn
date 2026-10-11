import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { git, resolveInRoot } from '@acorn/plugin-api/node'
import { parseDocument } from 'yaml'
import type { DependencyFinding, DependencyReview, LocalScope } from '../../shared/changes/api'
import type { StaticDependencyPolicy } from '@acorn/protocol/dependencyPolicy.ts'
import { isValidRelPath } from './localDiff'

const VERSION = 2
const MAX_FILE = 6 * 1024 * 1024
const MAX_TOTAL = 16 * 1024 * 1024
const MAX_PATHS = 5_000
const MAX_DECLARATIONS = 20_000
const DEPENDENCY_GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const INSTALLED_GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies']
const PYTHON_FILES = ['requirements.txt', 'pyproject.toml', 'uv.lock', 'Pipfile.lock']
const manifestName = (path: string) => path === 'package.json' || path.endsWith('/package.json')
const managerFiles = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  '.npmrc',
  '.pnpmrc',
  '.pnpmfile.cjs',
  '.yarnrc',
  '.yarnrc.yml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'npm.config.js',
  'requirements.txt',
  'pyproject.toml',
  'uv.lock',
  'Pipfile.lock',
]
const relevant = (path: string) =>
  manifestName(path) || managerFiles.some((name) => path === name || path.endsWith(`/${name}`))
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const safe = (value: unknown): string => {
  if (value && typeof value === 'object') return '[structured value]'
  const text = String(value)
  if (/^(?:git\+)?[a-z]+:\/\//i.test(text)) {
    try {
      const url = new URL(text.replace(/^git\+/, ''))
      const path = url.pathname === '/' ? '' : ` path:${digest(url.pathname).slice(0, 12)}`
      const revision = /^[#][0-9a-f]{7,64}$/i.test(url.hash)
        ? url.hash
        : url.hash
          ? `#${digest(url.hash).slice(0, 12)}`
          : ''
      return `${url.protocol}//${url.host}${path}${revision}`.slice(0, 400)
    } catch {
      return '[invalid URL]'
    }
  }
  if (/\$\{|\$\(|`/.test(text)) return '[dynamic value]'
  return text.slice(0, 400)
}
type Compared = { identity: string; display: string; truncated: boolean }
const compared = (value: unknown, limits: string[], context: string): Compared => {
  let entries = 0
  const canonical = (item: unknown, depth: number): string => {
    if (++entries > 10_000 || depth > 32) throw new Error('nested value exceeds comparison bounds')
    if (Array.isArray(item)) return `[${item.map((child) => canonical(child, depth + 1)).join(',')}]`
    if (item && typeof item === 'object')
      return `{${Object.entries(record(item))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child, depth + 1)}`)
        .join(',')}}`
    return JSON.stringify(item) ?? 'undefined'
  }
  try {
    const identity = digest(canonical(value, 0))
    // Policy values can contain credentials. Display is intentionally much smaller than identity.
    const display = typeof value === 'object' && value !== null ? '[structured policy value]' : safe(value)
    return {
      identity,
      display,
      truncated:
        display.length < (typeof value === 'string' ? value.length : 0) ||
        (typeof value === 'object' && value !== null),
    }
  } catch {
    limits.push(`${context}: nested policy exceeds comparison bounds.`)
    return { identity: '', display: '[unavailable]', truncated: true }
  }
}
const yaml = (text: string): Record<string, unknown> => {
  const parsed = parseDocument(text, { uniqueKeys: true })
  if (parsed.errors.length) throw new Error('Malformed YAML')
  const pending: { node: unknown; depth: number }[] = [{ node: parsed.contents, depth: 0 }]
  let entries = 0
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (++entries > 100_000 || depth > 32) throw new Error('YAML exceeds structural bounds')
    if (!node || typeof node !== 'object') continue
    const item = node as { items?: unknown[]; key?: unknown; value?: unknown }
    if (item.items) for (const child of item.items) pending.push({ node: child, depth: depth + 1 })
    if (item.key) pending.push({ node: item.key, depth: depth + 1 })
    if (item.value) pending.push({ node: item.value, depth: depth + 1 })
  }
  return record(parsed.toJS({ maxAliasCount: 0 }))
}
const json = (text: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error('Expected JSON object')
  return parsed
}

type FileSet = Map<string, string>
type Resolution = {
  name: string
  identity: string
  version: string
  versionIdentity: string
  source: string
  sourceIdentity: string
  integrity: string | null
  integrityIdentity: string | null
  optional: boolean
  path: string
  direct: boolean
}
type Parsed = {
  manager: DependencyReview['manager']
  version: string | null
  resolutions: Map<string, Resolution>
  direct: Map<string, Compared>
  scripts: Map<string, Compared>
  policy: Map<string, Compared>
  importers: Set<string>
  overrides: Set<string>
  limits: string[]
}
const empty = (): Parsed => ({
  manager: 'unknown',
  version: null,
  resolutions: new Map(),
  direct: new Map(),
  scripts: new Map(),
  policy: new Map(),
  importers: new Set(),
  overrides: new Set(),
  limits: [],
})
const recordTruncation = (out: Parsed, message: string) => {
  if (!out.limits.includes(message)) out.limits.push(message)
}
const addDirect = (out: Parsed, key: string, value: unknown) => {
  if (out.direct.size >= MAX_DECLARATIONS) {
    recordTruncation(out, 'More than 20,000 dependency declarations; analysis was truncated.')
    return
  }
  out.direct.set(key, compared(value, out.limits, key))
}
const addPolicy = (out: Parsed, path: string, name: string, value: unknown) => {
  if (out.policy.size >= 1_000) {
    recordTruncation(out, 'More than 1,000 policy settings; analysis was truncated.')
    return
  }
  const key = `${path}:${safe(name)}`
  const entry = compared(value, out.limits, key)
  const credential = /auth|token|password|secret|credential/i.test(name)
  out.policy.set(key, credential ? { ...entry, display: '[redacted]', truncated: true } : entry)
}
/** Throws when a lockfile entry holds a dependency group that isn't a table. */
const assertDependencyTables = (entry: Record<string, unknown>, message: string) => {
  for (const group of DEPENDENCY_GROUPS) {
    const table = entry[group]
    if (table !== undefined && !isRecord(table)) throw new Error(message)
  }
}

function parseFiles(files: FileSet, readLimits: string[]): Parsed {
  const out = empty()
  out.limits.push(...readLimits)
  const root = files.get('package.json')
  let rootManifest: Record<string, unknown> = {}
  if (root) {
    try {
      rootManifest = json(root)
    } catch {
      out.limits.push('package.json is malformed.')
    }
  }
  const declared =
    typeof rootManifest.packageManager === 'string'
      ? rootManifest.packageManager.match(
          /^(npm|pnpm)@(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+sha\d+\.[0-9a-f]+)?)$/,
        )
      : null
  const pnpm = files.has('pnpm-lock.yaml') || files.has('pnpm-workspace.yaml')
  const npm = files.has('package-lock.json') || files.has('npm-shrinkwrap.json')
  if (pnpm && npm) {
    out.manager = 'unsupported'
    out.limits.push('Mixed npm and pnpm files; effective resolution is unknown.')
    return out
  }
  out.manager = (declared?.[1] as Parsed['manager']) ?? (pnpm ? 'pnpm' : npm ? 'npm' : 'unknown')
  out.version = declared?.[2] ?? null
  if ((declared?.[1] === 'pnpm' && npm) || (declared?.[1] === 'npm' && pnpm)) {
    out.manager = 'unsupported'
    out.limits.push('Package manager declaration and lockfile format disagree.')
    return out
  }
  if (rootManifest.packageManager && !declared) {
    out.manager = 'unsupported'
    out.limits.push('Unsupported package manager declaration.')
    return out
  }
  if (files.has('yarn.lock') || files.has('bun.lock') || files.has('bun.lockb')) {
    out.manager = 'unsupported'
    out.limits.push('Yarn or Bun lockfile is unsupported.')
    return out
  }
  if (out.manager === 'unknown' && PYTHON_FILES.some((name) => files.has(name))) {
    out.manager = 'unsupported'
    out.limits.push('Python dependency files are unsupported.')
    return out
  }
  if (out.manager === 'unknown') out.limits.push('No supported package manager or lockfile found.')
  const lock =
    out.manager === 'pnpm'
      ? files.get('pnpm-lock.yaml')
      : out.manager === 'npm'
        ? (files.get('npm-shrinkwrap.json') ?? files.get('package-lock.json'))
        : undefined
  if (!lock && out.manager !== 'unknown') out.limits.push('Lockfile missing; installed resolutions are unknown.')
  for (const path of files.keys())
    if (path.includes('/') && managerFiles.some((name) => path.endsWith(`/${name}`)))
      out.limits.push(`${path}: nested dependency configuration is outside the root package manager review.`)

  for (const [path, text] of files) {
    if (PYTHON_FILES.some((name) => path === name || path.endsWith(`/${name}`)))
      out.limits.push(`${path}: Python dependencies are unsupported.`)
    if (path === '.pnpmfile.cjs' || path === 'npm.config.js')
      out.limits.push(`${path} is executable configuration and was not interpreted.`)
    else if (manifestName(path)) {
      try {
        const manifest = json(text)
        for (const group of DEPENDENCY_GROUPS) {
          for (const [name, spec] of Object.entries(record(manifest[group])))
            addDirect(out, `${path}:${group}:${name}`, spec)
        }
        for (const [name, command] of Object.entries(record(manifest.scripts)).filter(([name]) =>
          /^(preinstall|install|postinstall|prepare|prepublish|prepack|postpack)$/.test(name),
        )) {
          if (typeof command !== 'string') {
            out.limits.push(`${path}:${name}: lifecycle command is invalid.`)
            continue
          }
          if (out.scripts.size >= 1_000) {
            out.limits.push('More than 1,000 lifecycle scripts; analysis was truncated.')
            break
          }
          out.scripts.set(`${path}:${name}`, { identity: digest(command), display: 'declared', truncated: true })
        }
        if (path === 'package.json') {
          for (const key of ['packageManager', 'engines', 'overrides', 'resolutions'])
            if (key in manifest) addPolicy(out, path, key, manifest[key])
          for (const [key, value] of Object.entries(record(manifest.pnpm)))
            if (/build|overrides|age|registry|trust/i.test(key)) addPolicy(out, path, `pnpm.${key}`, value)
        }
      } catch {
        out.limits.push(`${path} is malformed.`)
      }
    } else if (path === 'pnpm-workspace.yaml' || path === '.yarnrc.yml') {
      try {
        const config = yaml(text)
        for (const [key, value] of Object.entries(config))
          if (/age|build|catalog|overrides|registry|trust|package/i.test(key)) addPolicy(out, path, key, value)
      } catch {
        out.limits.push(`${path} is malformed.`)
      }
    } else if (path === '.npmrc' || path === '.pnpmrc' || path === '.yarnrc') {
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([^=\s]+)\s*=\s*([^#\r\n]+)/)
        if (!match) continue
        const [, key, value] = match
        if (key === 'registry' || (key!.startsWith('@') && key!.endsWith(':registry')))
          addPolicy(out, path, key!, value)
        else if (/^(ignore-scripts|minimum-release-age|strict-ssl|engine-strict)$/.test(key!))
          addPolicy(out, path, key!, /^(true|false|\d+)$/i.test(value!.trim()) ? value!.trim() : '[uninterpreted]')
      }
      if (/\$\{|\$\(|`/.test(text)) out.limits.push(`${path} contains dynamic values; they were not evaluated.`)
    }
  }
  if (!lock) return out
  try {
    if (out.manager === 'npm')
      parseNpm(out, json(lock), files.has('npm-shrinkwrap.json') ? 'npm-shrinkwrap.json' : 'package-lock.json')
    if (out.manager === 'pnpm') parsePnpm(out, yaml(lock))
  } catch {
    out.limits.push('Lockfile is malformed or unsupported; installed resolutions are unknown.')
    out.resolutions.clear()
  }
  if (!out.limits.some((limit) => /Lockfile is malformed|Unsupported .* lockfile/.test(limit))) {
    for (const [key, spec] of out.direct) {
      if (key.includes(':lock ') || key.includes(':resolved ')) continue
      const [path, group, name] = key.split(':')
      if (!out.importers.has(path!)) {
        out.limits.push(`${path}: manifest importer is absent from lockfile.`)
        continue
      }
      if (group === 'peerDependencies') continue
      const lockSpec = out.direct.get(
        key.replace(/:(dependencies|devDependencies|optionalDependencies|peerDependencies):/, ':lock $1:'),
      )
      if (lockSpec === undefined) {
        if (!INSTALLED_GROUPS.some((other) => out.direct.has(`${path}:lock ${other}:${name}`)))
          out.limits.push(`${key}: lockfile resolution is missing.`)
      } else if (
        lockSpec.identity !== spec.identity &&
        !spec.display.startsWith('catalog:') &&
        !out.overrides.has(name!)
      )
        out.limits.push(`${key}: manifest and lockfile specifiers disagree.`)
    }
  }
  return out
}

function parseNpm(out: Parsed, lock: Record<string, unknown>, lockPath: string) {
  if (![2, 3].includes(Number(lock.lockfileVersion))) {
    out.limits.push('Unsupported npm lockfile version.')
    return
  }
  if (!isRecord(lock.packages)) throw new Error('invalid packages')
  const packages = lock.packages
  if (!isRecord(packages[''])) throw new Error('npm root importer missing')
  if (Object.keys(packages).length > 10_000) throw new Error('npm packages table too large')
  for (const [path, item] of Object.entries(packages)) {
    if (!isRecord(item)) throw new Error('invalid npm package')
    assertDependencyTables(item, 'invalid npm dependency table')
    if (!path || !path.includes('node_modules/')) {
      const manifest = path ? `${path}/package.json` : 'package.json'
      out.importers.add(manifest)
      for (const group of DEPENDENCY_GROUPS) {
        for (const [name, spec] of Object.entries(record(item[group])))
          addDirect(out, `${manifest}:lock ${group}:${name}`, spec)
      }
    }
    if (!path) continue
    const name = typeof item.name === 'string' ? item.name : path.split('node_modules/').at(-1)!
    if (item.version !== undefined && typeof item.version !== 'string') throw new Error('invalid npm version')
    const rawVersion = item.version ?? 'unknown'
    const version = safe(rawVersion)
    if (item.resolved !== undefined && typeof item.resolved !== 'string') throw new Error('invalid npm resolved URL')
    const rawSource = item.resolved ?? (item.link ? 'workspace link' : 'unreported')
    const source = safe(rawSource)
    const owner = path.slice(0, path.lastIndexOf('node_modules/')).replace(/\/$/, '')
    const manifest = owner ? `${owner}/package.json` : 'package.json'
    const installName = path.split('node_modules/').at(-1)!
    const direct = DEPENDENCY_GROUPS.some((group) => out.direct.has(`${manifest}:lock ${group}:${installName}`))
    out.resolutions.set(path, {
      name,
      identity: path,
      version,
      versionIdentity: digest(rawVersion),
      source,
      sourceIdentity: digest(rawSource),
      integrity: typeof item.integrity === 'string' ? safe(item.integrity) : null,
      integrityIdentity: typeof item.integrity === 'string' ? digest(item.integrity) : null,
      optional: item.optional === true,
      path: lockPath,
      direct,
    })
  }
}

function parsePnpm(out: Parsed, lock: Record<string, unknown>) {
  if (!/^9\.\d+$/.test(String(lock.lockfileVersion))) {
    out.limits.push('Unsupported pnpm lockfile version.')
    return
  }
  for (const field of ['importers', 'packages', 'snapshots'])
    if (lock[field] !== undefined && !isRecord(lock[field])) throw new Error(`invalid ${field}`)
  if (!Object.keys(record(lock.importers)).length) {
    out.limits.push('pnpm importers table missing.')
    return
  }
  if (Object.keys(record(lock.packages)).length + Object.keys(record(lock.snapshots)).length > 10_000)
    throw new Error('pnpm resolution table too large')
  for (const key of Object.keys(record(lock.overrides))) out.overrides.add(key)
  for (const [key, item] of Object.entries(record(lock.packages))) {
    if (!isRecord(item)) throw new Error('invalid pnpm package')
    const resolution = item.resolution
    if (!isRecord(resolution)) throw new Error('invalid pnpm resolution')
    for (const field of ['tarball', 'repo', 'type', 'commit', 'hash', 'integrity'])
      if (resolution[field] !== undefined && typeof resolution[field] !== 'string')
        throw new Error('invalid pnpm resolution field')
    const split = key.lastIndexOf('@')
    const name = split > 0 ? key.slice(0, split) : key
    const version = split > 0 ? safe(key.slice(split + 1)) : 'unknown'
    const { integrity: _integrity, ...sourceFields } = resolution
    const sourceIdentity = compared(sourceFields, out.limits, `pnpm-lock.yaml:${key}:resolution`).identity
    out.resolutions.set(key, {
      name,
      identity: key,
      version,
      versionIdentity: digest(key.slice(split + 1)),
      source:
        safe(resolution.tarball ?? resolution.repo ?? resolution.type ?? 'registry') +
        (resolution.commit || resolution.hash ? `#${safe(resolution.commit ?? resolution.hash)}` : ''),
      sourceIdentity,
      integrity: typeof resolution.integrity === 'string' ? safe(resolution.integrity) : null,
      integrityIdentity: typeof resolution.integrity === 'string' ? digest(resolution.integrity) : null,
      optional: item.optional === true,
      path: 'pnpm-lock.yaml',
      direct: false,
    })
  }
  // Snapshot keys preserve peer context and patched variants. A package table entry may be shared by
  // several snapshots, so keep the snapshot identity as well when it differs.
  for (const [key, item] of Object.entries(record(lock.snapshots))) {
    if (!isRecord(item)) throw new Error('invalid pnpm snapshot')
    if (out.resolutions.has(key)) continue
    const base = key.replace(/\(.+$/, '')
    const parent = out.resolutions.get(base)
    if (parent)
      out.resolutions.set(key, { ...parent, identity: key, optional: item.optional === true || parent.optional })
    else {
      out.limits.push(`${key}: snapshot has no package resolution metadata.`)
      out.resolutions.set(key, {
        name: key.slice(0, key.lastIndexOf('@')),
        identity: key,
        version: safe(key.slice(key.lastIndexOf('@') + 1)),
        versionIdentity: digest(key.slice(key.lastIndexOf('@') + 1)),
        source: 'unreported',
        sourceIdentity: digest('unreported'),
        integrity: null,
        integrityIdentity: null,
        optional: item.optional === true,
        path: 'pnpm-lock.yaml',
        direct: false,
      })
    }
  }
  for (const [importer, entry] of Object.entries(record(lock.importers))) {
    if (!isRecord(entry)) throw new Error('invalid pnpm importer')
    assertDependencyTables(entry, 'invalid pnpm importer dependencies')
    const path = importer === '.' ? 'package.json' : `${importer}/package.json`
    out.importers.add(path)
    for (const group of DEPENDENCY_GROUPS) {
      for (const [name, item] of Object.entries(record(entry[group]))) {
        if (!isRecord(item)) throw new Error('invalid pnpm importer dependency')
        if (typeof item.specifier !== 'string' || !item.specifier || typeof item.version !== 'string' || !item.version)
          throw new Error('invalid pnpm importer specifier or version')
        addDirect(out, `${path}:lock ${group}:${name}`, item.specifier)
        addDirect(out, `${path}:resolved ${group}:${name}`, item.version)
        if (/^(?:link:|workspace:)/.test(item.version)) continue
        const coordinate = [`${name}@${item.version}`, item.version].find(
          (candidate) => out.resolutions.has(candidate) || out.resolutions.has(candidate.replace(/\(.+$/, '')),
        )
        if (!coordinate) {
          out.limits.push(`${path}:${group}:${name}: lockfile resolution metadata is missing.`)
          continue
        }
        const base = coordinate.replace(/\(.+$/, '')
        if (coordinate !== base && !out.resolutions.has(coordinate))
          out.limits.push(`${path}:${group}:${name}: peer snapshot is missing.`)
        const packageEntry = out.resolutions.get(base)
        const snapshot = out.resolutions.get(coordinate)
        if (packageEntry) packageEntry.direct = true
        if (snapshot) snapshot.direct = true
      }
    }
  }
}

function compare(before: Parsed, after: Parsed): DependencyFinding[] {
  const findings: DependencyFinding[] = []
  let overflow = false
  const add = (finding: DependencyFinding) => {
    if (findings.length < 1_000) findings.push(finding)
    else overflow = true
  }
  const diff = (a: Map<string, Compared>, b: Map<string, Compared>, kind: DependencyFinding['kind']) => {
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const old = a.get(key) ?? null,
        next = b.get(key) ?? null
      if (old?.identity !== next?.identity)
        add({
          path: key.slice(0, key.indexOf(':')),
          kind,
          name: key.slice(key.indexOf(':') + 1),
          before: old?.display ?? null,
          after: next?.display ?? null,
          detail:
            kind === 'script'
              ? 'Declared lifecycle command changed; command text withheld.'
              : old?.truncated || next?.truncated
                ? 'Full value changed; display is abbreviated or redacted.'
                : undefined,
          warning:
            (kind === 'policy' && /age|build|registry|override|trust|ignore-scripts/i.test(key)) ||
            (kind === 'script' && next !== null),
        })
    }
  }
  diff(before.direct, after.direct, 'direct')
  diff(before.scripts, after.scripts, 'script')
  diff(before.policy, after.policy, 'policy')
  if (before.version !== after.version)
    add({
      path: 'package.json',
      kind: 'policy',
      name: 'package manager version',
      before: before.version,
      after: after.version,
    })
  const keys = new Set([...before.resolutions.keys(), ...after.resolutions.keys()])
  for (const key of keys) {
    const old = before.resolutions.get(key),
      next = after.resolutions.get(key)
    const name = safe(next?.name ?? old?.name ?? key)
    const path = next?.path ?? old?.path ?? 'package-lock.json'
    if (!old || !next) {
      add({
        path,
        kind: old?.direct || next?.direct ? 'direct' : 'transitive',
        name,
        before: old?.version ?? null,
        after: next?.version ?? null,
        detail: safe(key),
      })
      add({ path, kind: 'source', name, before: old?.source ?? null, after: next?.source ?? null, detail: safe(key) })
      if (old?.integrity || next?.integrity)
        add({
          path,
          kind: 'integrity',
          name,
          before: old?.integrity ?? null,
          after: next?.integrity ?? null,
          detail: safe(key),
        })
      else if (next)
        add({
          path,
          kind: 'integrity',
          name,
          before: null,
          after: null,
          detail: `${safe(key)}: lockfile entry has no integrity metadata`,
        })
    } else {
      if (old.versionIdentity !== next.versionIdentity)
        add({
          path,
          kind: old.direct || next.direct ? 'direct' : 'transitive',
          name,
          before: old.version,
          after: next.version,
          detail: safe(key),
        })
      if (old.sourceIdentity !== next.sourceIdentity) {
        const hidden = old.source === next.source ? ': full source changed; display abbreviated or redacted' : ''
        add({ path, kind: 'source', name, before: old.source, after: next.source, detail: `${safe(key)}${hidden}` })
      }
      if (old.integrityIdentity !== next.integrityIdentity)
        add({ path, kind: 'integrity', name, before: old.integrity, after: next.integrity, detail: safe(key) })
      if (old.optional !== next.optional)
        add({
          path,
          kind: 'transitive',
          name,
          before: `optional=${old.optional}`,
          after: `optional=${next.optional}`,
          detail: safe(key),
        })
    }
  }
  if (overflow) after.limits.push('More than 1,000 dependency findings; the list was truncated.')
  return findings
}

type GitRead = typeof git
type GitEntries = {
  tree: string | null
  head: Map<string, string>
  index: Map<string, string>
  untracked: string[]
  unsafe: string[]
  signature: string
}
async function gitEntries(root: string, scope: LocalScope, run: GitRead): Promise<GitEntries> {
  const options = { cwd: root, maxOutputBytes: 2 * 1024 * 1024, timeoutMs: 15_000 }
  const treeResult = await run(['rev-parse', '--verify', 'HEAD^{tree}'], options)
  const tree = treeResult.code === 0 ? treeResult.stdout.trim() : null
  const [headResult, indexResult, untrackedResult] = await Promise.all([
    tree ? run(['ls-tree', '-r', '-z', tree], options) : Promise.resolve(null),
    run(['ls-files', '--stage', '-z'], options),
    scope === 'unstaged' ? run(['ls-files', '--others', '--exclude-standard', '-z'], options) : Promise.resolve(null),
  ])
  if (headResult?.code || indexResult.code || untrackedResult?.code) throw new Error('Git enumeration failed')
  const head = new Map<string, string>(),
    index = new Map<string, string>(),
    unsafe: string[] = []
  for (const row of headResult?.stdout.split('\0') ?? []) {
    if (!row) continue
    const match = row.match(/^(\d+) blob ([0-9a-f]{40,64})\t(.+)$/)
    if (match && isValidRelPath(match[3]!) && relevant(match[3]!)) {
      if (match[1] === '120000') unsafe.push(match[3]!)
      else head.set(match[3]!, match[2]!)
    }
  }
  for (const row of indexResult.stdout.split('\0')) {
    if (!row) continue
    const match = row.match(/^(\d+) ([0-9a-f]{40,64}) (\d)\t(.+)$/)
    if (match && isValidRelPath(match[4]!) && relevant(match[4]!)) {
      if (match[1] === '120000' || match[3] !== '0') unsafe.push(match[4]!)
      else index.set(match[4]!, match[2]!)
    }
  }
  const untracked = untrackedResult?.stdout.split('\0').filter((path) => isValidRelPath(path) && relevant(path)) ?? []
  if (new Set([...head.keys(), ...index.keys(), ...untracked]).size > MAX_PATHS)
    throw new Error('Too many dependency files')
  return {
    tree,
    head,
    index,
    untracked,
    unsafe,
    signature: digest(JSON.stringify([tree, indexResult.stdout, untrackedResult?.stdout])),
  }
}

async function gitBlob(root: string, oid: string, run: GitRead): Promise<string> {
  const result = await run(['cat-file', 'blob', oid], { cwd: root, maxOutputBytes: MAX_FILE + 1, timeoutMs: 15_000 })
  if (result.code) throw new Error('Git object unavailable')
  return result.stdout
}

async function diskFile(root: string, path: string, maxBytes = MAX_FILE, signal?: AbortSignal): Promise<string | null> {
  const absolute = resolveInRoot(root, path)
  if (!absolute) throw new Error('Path escapes worktree.')
  // Refuse a leaf symlink, even when it points inside the worktree.
  let file
  try {
    file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('Dependency file is not regular or exceeds size bound.')
    const chunks: Buffer[] = []
    let offset = 0
    while (true) {
      if (signal?.aborted) throw new Error('cancelled')
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - offset))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      if (!bytesRead) break
      offset += bytesRead
      if (offset > maxBytes) throw new Error('Dependency file grew beyond size bound.')
      chunks.push(buffer.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await file.close()
  }
}

async function snapshots(
  root: string,
  scope: LocalScope,
  run: GitRead,
): Promise<{ old: { files: FileSet; limits: string[] }; next: { files: FileSet; limits: string[] }; stale: boolean }> {
  const old = { files: new Map<string, string>(), limits: [] as string[] }
  const next = { files: new Map<string, string>(), limits: [] as string[] }
  let total = 0
  let entries: GitEntries
  try {
    entries = await gitEntries(root, scope, run)
  } catch {
    return {
      old,
      next: {
        files: next.files,
        limits: ['Dependency path listing failed or exceeded its 2 MiB and 5,000-file bounds.'],
      },
      stale: false,
    }
  }
  const candidates = [...new Set([...entries.head.keys(), ...entries.index.keys(), ...entries.untracked])]
  for (const path of new Set(entries.unsafe))
    next.limits.push(`${path}: symlink or unresolved index conflict was not interpreted.`)
  for (const path of candidates) {
    for (const [side, oid] of [
      [old, scope === 'staged' ? entries.head.get(path) : entries.index.get(path)],
      [next, scope === 'staged' ? entries.index.get(path) : undefined],
    ] as const) {
      if (!oid) continue
      try {
        const value = await gitBlob(root, oid, run)
        total += Buffer.byteLength(value)
        if (total > MAX_TOTAL) throw new Error('total bound')
        side.files.set(path, value)
      } catch {
        side.limits.push(`${path}: unreadable, unsafe, or oversized.`)
      }
    }
    if (scope === 'unstaged') {
      try {
        const value = await diskFile(root, path)
        if (value !== null) {
          total += Buffer.byteLength(value)
          if (total > MAX_TOTAL) throw new Error('total bound')
          next.files.set(path, value)
        }
      } catch {
        next.limits.push(`${path}: unreadable, unsafe, or oversized.`)
      }
    }
    if (total > MAX_TOTAL) {
      next.limits.push('Dependency files exceed the 16 MiB review budget.')
      break
    }
  }
  let stale = false
  try {
    stale = (await gitEntries(root, scope, run)).signature !== entries.signature
    if (scope === 'unstaged')
      for (const path of candidates) {
        if ((await diskFile(root, path)) !== (next.files.get(path) ?? null)) {
          stale = true
          break
        }
      }
  } catch {
    stale = true
  }
  return { old, next, stale }
}

export async function dependencyReview(
  root: string,
  scope: LocalScope,
  taskId = root,
  run: GitRead = git,
): Promise<DependencyReview> {
  const canonical = await realpath(root)
  const { old, next, stale } = await snapshots(canonical, scope, run)
  const before = parseFiles(old.files, old.limits),
    after = parseFiles(next.files, next.limits)
  const revision = digest(
    JSON.stringify([
      taskId,
      canonical,
      scope,
      after.manager,
      [...old.files].map(([path, value]) => [path, digest(value)]),
      [...next.files].map(([path, value]) => [path, digest(value)]),
      old.limits,
      next.limits,
      VERSION,
    ]),
  )
  const findings = stale ? [] : compare(before, after)
  const alias = new Map<string, string>()
  for (const [key, value] of [...before.direct, ...after.direct]) {
    const actual = value.display.match(/^npm:(.+)@[^@]+$/)?.[1]
    if (actual) alias.set(key.split(':').at(-1)!, actual)
  }
  const packageCount = new Set(
    findings
      .filter((finding) => ['direct', 'transitive', 'source', 'integrity'].includes(finding.kind))
      .map(
        (finding) =>
          alias.get(finding.name.split(':').at(-1)!) ??
          (finding.kind === 'direct' && finding.name.includes(':') ? finding.name.split(':').at(-1)! : finding.name),
      ),
  ).size
  const limits = [
    ...new Set([
      ...before.limits,
      ...after.limits,
      ...(stale ? ['Git index, HEAD, or disk changed during review; retry for a coherent result.'] : []),
      'Installed dependency scripts, release dates, provenance, and malware status are unknown from repository files.',
    ]),
  ]
  return {
    scope,
    revision: `sha256:${revision}`,
    analyzerVersion: VERSION,
    manager: after.manager,
    managerVersion: after.version,
    coverage:
      after.manager === 'unsupported'
        ? 'unsupported'
        : limits.length > 1 || after.manager === 'unknown'
          ? 'partial'
          : 'complete',
    packageCount,
    findings,
    limits,
  }
}

export async function staticDependencyPolicy(root: string, signal?: AbortSignal): Promise<StaticDependencyPolicy> {
  const canonical = await realpath(root)
  const files: FileSet = new Map(),
    limits: string[] = []
  let total = 0
  for (const name of ['package.json', 'pnpm-workspace.yaml', '.npmrc', '.pnpmrc', '.pnpmfile.cjs', 'npm.config.js']) {
    if (signal?.aborted) throw new Error('cancelled')
    try {
      const content = await diskFile(canonical, name, 32 * 1024, signal)
      if (content !== null) {
        total += Buffer.byteLength(content)
        if (total > 128 * 1024) {
          limits.push('Static policy files exceed the 128 KiB total bound.')
          break
        }
        files.set(name, content)
      }
    } catch {
      limits.push(`${name}: unreadable, unsafe, or oversized.`)
    }
  }
  const present = async (name: string) => {
    const absolute = resolveInRoot(canonical, name)
    if (!absolute) return false
    try {
      const stat = await lstat(absolute)
      if (!stat.isFile()) limits.push(`${name}: unsafe lockfile path.`)
      return stat.isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      limits.push(`${name}: inaccessible.`)
      return false
    }
  }
  const [pnpmLock, npmLock, shrinkwrap] = await Promise.all(
    ['pnpm-lock.yaml', 'package-lock.json', 'npm-shrinkwrap.json'].map(present),
  )
  let manifest: Record<string, unknown> = {},
    workspace: Record<string, unknown> = {}
  try {
    if (files.has('package.json')) manifest = json(files.get('package.json')!)
  } catch {
    limits.push('package.json is malformed.')
  }
  try {
    if (files.has('pnpm-workspace.yaml')) workspace = yaml(files.get('pnpm-workspace.yaml')!)
  } catch {
    limits.push('pnpm-workspace.yaml is malformed.')
  }
  const declaration =
    typeof manifest.packageManager === 'string'
      ? manifest.packageManager.match(/^(npm|pnpm)@(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+sha\d+\.[0-9a-f]+)?)$/)
      : null
  const manager: StaticDependencyPolicy['manager'] =
    pnpmLock && (npmLock || shrinkwrap)
      ? 'unsupported'
      : declaration
        ? (declaration[1] as 'npm' | 'pnpm')
        : pnpmLock || files.has('pnpm-workspace.yaml')
          ? 'pnpm'
          : npmLock || shrinkwrap
            ? 'npm'
            : 'unknown'
  if (manager === 'unsupported') limits.push('Mixed npm and pnpm lockfiles.')
  if (manifest.packageManager && !declaration) limits.push('Package manager declaration is unsupported or malformed.')
  if ((declaration?.[1] === 'pnpm' && (npmLock || shrinkwrap)) || (declaration?.[1] === 'npm' && pnpmLock))
    limits.push('Package manager declaration and lockfile format disagree.')
  if (files.has('.pnpmfile.cjs') || files.has('npm.config.js'))
    limits.push('Executable package manager configuration was not interpreted.')
  const policyKeys = Object.keys(workspace)
    .filter((key) => /age|build|catalog|override|registry|trust/i.test(key))
    .map((key) => `pnpm-workspace.yaml:${key}`)
  const pnpm = record(manifest.pnpm)
  policyKeys.push(
    ...Object.keys(pnpm)
      .filter((key) => /age|build|catalog|override|registry|trust/i.test(key))
      .map((key) => `package.json:pnpm.${key}`),
  )
  for (const key of ['overrides', 'resolutions', 'engines']) if (key in manifest) policyKeys.push(`package.json:${key}`)
  const registryOrigins = new Set<string>()
  const sourcePolicyKeys = policyKeys.filter((key) => /override|resolution|catalog|registry/i.test(key))
  let ignoreScripts: boolean | null = null
  let ageFromRc: number | null = null
  for (const name of ['.npmrc', '.pnpmrc'])
    for (const line of (files.get(name) ?? '').split(/\r?\n/)) {
      const match = line.match(/^\s*([^=\s]+)\s*=\s*(.*?)\s*$/)
      if (!match) continue
      const [, key, value] = match
      if (key === 'ignore-scripts' && /^(true|false)$/i.test(value!)) ignoreScripts = value!.toLowerCase() === 'true'
      else if (key === 'ignore-scripts') limits.push(`${name}: ignore-scripts value is not interpretable.`)
      if (key === 'minimum-release-age' && /^\d{1,7}$/.test(value!)) ageFromRc = Number(value)
      else if (key === 'minimum-release-age') limits.push(`${name}: minimum-release-age value is not interpretable.`)
      if (key === 'registry' || (key!.startsWith('@') && key!.endsWith(':registry'))) {
        policyKeys.push(`${name}:${key}`)
        sourcePolicyKeys.push(`${name}:${key}`)
        try {
          const url = new URL(value!)
          if (['https:', 'http:'].includes(url.protocol)) registryOrigins.add(url.origin)
        } catch {
          limits.push(`${name}:${key}: registry origin is invalid or dynamic.`)
        }
      }
    }
  const age = workspace.minimumReleaseAge
  const releaseAgeMinutes = typeof age === 'number' && Number.isSafeInteger(age) && age >= 0 ? age : ageFromRc
  if (age !== undefined && !(typeof age === 'number' && Number.isSafeInteger(age) && age >= 0))
    limits.push('pnpm minimumReleaseAge could not be interpreted.')
  const buildList = (value: unknown, label: string): Set<string> | null => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
      limits.push(`${label} could not be interpreted.`)
      return null
    }
    return new Set(value)
  }
  let approvals: Set<string> | null = null
  let deniedByMap: Set<string> | null = null
  if (workspace.allowBuilds !== undefined) {
    const allowBuilds = workspace.allowBuilds
    if (
      !allowBuilds ||
      typeof allowBuilds !== 'object' ||
      Array.isArray(allowBuilds) ||
      Object.values(record(allowBuilds)).some((value) => typeof value !== 'boolean')
    ) {
      limits.push('allowBuilds could not be interpreted.')
    } else {
      approvals = new Set(
        Object.entries(record(allowBuilds))
          .filter(([, allowed]) => allowed === true)
          .map(([name]) => name),
      )
      deniedByMap = new Set(
        Object.entries(record(allowBuilds))
          .filter(([, allowed]) => allowed === false)
          .map(([name]) => name),
      )
    }
  } else if (workspace.onlyBuiltDependencies !== undefined)
    approvals = buildList(workspace.onlyBuiltDependencies, 'Workspace onlyBuiltDependencies')
  else if (pnpm.onlyBuiltDependencies !== undefined)
    approvals = buildList(pnpm.onlyBuiltDependencies, 'Manifest onlyBuiltDependencies')
  const ignoredBuilds = workspace.ignoredBuiltDependencies ?? pnpm.ignoredBuiltDependencies
  let denied = deniedByMap
  if (ignoredBuilds !== undefined) {
    const ignoredList = buildList(ignoredBuilds, 'ignoredBuiltDependencies')
    denied =
      ignoredList && (workspace.allowBuilds === undefined || deniedByMap !== null)
        ? new Set([...(denied ?? []), ...ignoredList])
        : null
  }
  const buildApprovalCount = approvals?.size ?? null
  const buildIgnoreCount = denied?.size ?? null
  const allowAllBuilds =
    typeof workspace.dangerouslyAllowAllBuilds === 'boolean' ? workspace.dangerouslyAllowAllBuilds : null
  if (workspace.dangerouslyAllowAllBuilds !== undefined && allowAllBuilds === null)
    limits.push('dangerouslyAllowAllBuilds could not be interpreted.')
  const exceptions = workspace.minimumReleaseAgeExclude
  const releaseAgeExceptionCount = Array.isArray(exceptions) ? exceptions.length : null
  if (exceptions !== undefined && releaseAgeExceptionCount === null)
    limits.push('Release-age exceptions could not be interpreted.')
  if (policyKeys.length > 10 || sourcePolicyKeys.length > 10 || registryOrigins.size > 5)
    limits.push('Static policy names or registry origins were truncated.')
  const boundedNames = (names: string[]) => names.slice(0, 10).map((name) => safe(name).slice(0, 80))
  return {
    manager,
    managerVersion: declaration?.[2] ?? null,
    policyKeys: boundedNames(policyKeys),
    releaseAgeMinutes,
    ignoreScripts,
    buildApprovalCount,
    buildIgnoreCount,
    allowAllBuilds,
    releaseAgeExceptionCount,
    registryOrigins: [...registryOrigins].slice(0, 5).map((origin) => origin.slice(0, 120)),
    sourcePolicyKeys: boundedNames(sourcePolicyKeys),
    limits,
  }
}
