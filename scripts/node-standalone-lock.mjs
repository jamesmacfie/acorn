#!/usr/bin/env node
// The standalone Node's npm manifest and the reviewed lockfile every release installs from
// (docs/node-distribution/dependency-security.md).
//
//   pnpm lock:node   resolves apps/node/standalone/package-lock.json again from the current manifest
//
// scripts/pack-node.mjs refuses to pack when the committed manifest differs from the one these sources
// produce, so a dependency change can't reach a release until someone relocks and the diff is reviewed.

import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { requiredRuntimePackages } from './nodeRuntimePackages.ts'
import { REVIEWED_PACKAGES } from './prune-runtime.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const LOCK_DIR = join(ROOT, 'apps/node/standalone')

// The shared service/helper runtime set plus the terminal client's extra externals. Versions are read
// from apps/desktop's manifest rather than repeated here, since that package already pins them for
// the bundled node, so the packaged app and the standalone one cannot diverge.
export const RUNTIME = [
  ...requiredRuntimePackages,
  // The terminal bundle leaves these Node-core imports external, even though the standalone service
  // bundle includes them. They are required beside the shared `acorn` launcher.
  'drizzle-orm',
  'hono',
]

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
const workspaceText = () => readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')

// The entries of one top-level map in pnpm-workspace.yaml, as `key: value` pairs with the quotes removed.
function workspaceSection(text, section) {
  const lines = text.split(/\r?\n/)
  const start = lines.indexOf(`${section}:`) + 1
  if (start === 0) throw new Error(`pnpm-workspace.yaml has no ${section} section.`)
  const end = lines.findIndex((line, index) => index >= start && /^[^\s#]/.test(line))
  return Object.fromEntries(
    lines
      .slice(start, end === -1 ? undefined : end)
      .map((line) => /^\s{2}"?([@\w./-]+)"?:\s*"?([^"]+?)"?\s*$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2]]),
  )
}

/**
 * The fields of the standalone package.json that decide what npm resolves. The packer adds the rest
 * (version, entry points, engines). Also returns the runtime set the terminal bundle check uses.
 */
export function standaloneManifest() {
  const workspaceManifest = read(join(ROOT, 'package.json'))
  const desktop = read(join(ROOT, 'apps/desktop/package.json'))
  const tui = read(join(ROOT, 'apps/tui/package.json'))
  // `catalog:` entries are resolved out of pnpm-workspace.yaml, which is where the single-versioned
  // packages live (a duplicate zod means schema instances that fail each other's instanceof checks).
  const catalog = workspaceSection(workspaceText(), 'catalog')

  const dependencies = {}
  const runtime = new Set([...RUNTIME, ...Object.keys(tui.dependencies ?? {}).filter((name) => !name.startsWith('@acorn/'))])
  for (const name of runtime) {
    const declared = desktop.dependencies?.[name] ?? tui.dependencies?.[name]
    if (!declared) throw new Error(`${name} is in the standalone runtime set but has no declared version.`)
    const version = declared === 'catalog:' ? catalog[name] : declared
    if (!version) throw new Error(`${name} is declared as 'catalog:' but pnpm-workspace.yaml has no entry for it.`)
    dependencies[name] = version
  }
  // A provider's compatible range can still select a release requiring a newer Node than Acorn.
  // These narrow pins match the tested workspace graph; the root manifest owns their rationale.
  for (const [name, version] of Object.entries(workspaceManifest.acornStandalone.dependencyPins)) {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`${name} is pinned but absent from the standalone runtime set.`)
    dependencies[name] = version
  }
  // The install prunes against exact reviewed versions and refuses any other, so lock those versions here.
  // The adapter pins its SDK exactly, which covers the one reviewed package that isn't direct.
  for (const [name, { version }] of Object.entries(REVIEWED_PACKAGES)) {
    if (Object.hasOwn(dependencies, name)) dependencies[name] = version
  }

  const manifest = {
    name: 'acorn-node',
    private: true,
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    // npm does not inherit pnpm-workspace.yaml; carry the verified runtime security floors.
    overrides: {
      ...Object.fromEntries(
        Object.entries(workspaceManifest.overrides).map(([name, version]) => [
          name,
          // npm requires a direct dependency's override to match its declared specifier. A $ref
          // also keeps transitive copies aligned with that dependency's patched manifest floor.
          Object.hasOwn(dependencies, name) ? `$${name}` : version,
        ]),
      ),
      ...workspaceManifest.acornStandalone.peerOverrides,
    },
  }
  return { manifest, runtime }
}

/**
 * The installed packages whose install scripts may run, from pnpm's `allowBuilds` in
 * pnpm-workspace.yaml, the same list the workspace install obeys. A locked package with an install
 * script that the list doesn't name fails, so a new script gets reviewed before any release runs it.
 */
export function allowedInstallScripts(lock, allowBuilds = workspaceSection(workspaceText(), 'allowBuilds')) {
  const allowed = new Set()
  const unreviewed = new Set()
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!entry.hasInstallScript) continue
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    if (allowBuilds[name] === 'true') allowed.add(name)
    else if (allowBuilds[name] !== 'false') unreviewed.add(name)
  }
  if (unreviewed.size) {
    throw new Error(
      `The standalone lockfile installs packages with unreviewed install scripts: ${[...unreviewed].join(', ')}.\n` +
        'Read each script, then name the package under allowBuilds in pnpm-workspace.yaml: true to run it, false to skip it.',
    )
  }
  return [...allowed].sort()
}

/** The committed manifest and lockfile. */
export function reviewedLock() {
  return { manifest: read(join(LOCK_DIR, 'package.json')), lock: read(join(LOCK_DIR, 'package-lock.json')) }
}

// Resolves the lockfile again. npm keeps every locked version that still satisfies the manifest, so a
// relock moves only what the manifest change requires. `--before` applies pnpm's minimumReleaseAge, so
// a version published within that window can't enter the lockfile.
function relock() {
  const minimumReleaseAge = Number(/^minimumReleaseAge: (\d+)$/m.exec(workspaceText())?.[1])
  if (!minimumReleaseAge) throw new Error('pnpm-workspace.yaml has no minimumReleaseAge.')
  const before = new Date(Date.now() - minimumReleaseAge * 60_000).toISOString()
  mkdirSync(LOCK_DIR, { recursive: true })
  writeFileSync(join(LOCK_DIR, 'package.json'), `${JSON.stringify(standaloneManifest().manifest, null, 2)}\n`)
  // Through a shell, because Windows runs npm as npm.cmd, which execFile can't start.
  execSync(`npm install --package-lock-only --ignore-scripts --no-audit --no-fund --before=${before}`, {
    cwd: LOCK_DIR,
    stdio: 'inherit',
  })
  const scripts = allowedInstallScripts(reviewedLock().lock)
  console.log(`[lock-node] locked to releases before ${before}. Install scripts that run: ${scripts.join(', ') || 'none'}.`)
  console.log('[lock-node] review the diff in apps/node/standalone before you commit it.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) relock()
