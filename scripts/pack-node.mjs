#!/usr/bin/env node
// Assemble a standalone Acorn Node tarball. See docs/node-distribution.md for what an operator does
// with the result.
//
// ## Why a tarball and not an npm package
//
// `apps/node` is `private`, every `@acorn/*` dependency is `workspace:*`, and the dependency that
// matters most, node-pty, is native. An `npx`-able package would need prebuilt binaries for every
// (platform, arch, Node ABI) triple, which is a release pipeline rather than a script. A tarball the
// operator unpacks and runs `npm install --omit=dev` in compiles node-pty against their own Node,
// the same dance a developer already does here (`pnpm rebuild:node`).
//
// ## What goes in
//
//   dist/          the Node artifact plus cli/ and tui/ client bundles
//   bin/acorn.mjs  thin command-versus-terminal launcher
//   migrations/    every Drizzle chain: core's at the root, each plugin's under its own name
//   package.json   generated, listing only the real runtime dependencies (see RUNTIME below)
//   README.md      pointing at docs/node-distribution.md
//
// The desktop renderer, the shell and every `@acorn/*` package are absent by construction: the
// builds bundle first-party source into the artifacts, so the archive needs none of them at runtime.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { requiredRuntimePackages } from './nodeRuntimePackages.ts'

// The standalone manifest uses the same supported security range as the checkout.
const workspaceManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const NODE_ENGINES = workspaceManifest.engines.node

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NODE_APP = join(ROOT, 'apps/node')
const CLI_APP = join(ROOT, 'apps/cli')
const TUI_APP = join(ROOT, 'apps/tui')
const OUT = join(ROOT, 'apps/node/release')

// The shared service/helper runtime set plus the terminal client's extra externals. Versions are read
// from apps/desktop's manifest rather than repeated here, since that package already pins them for
// the bundled node, so the packaged app and the standalone one cannot diverge.
// `assertManifestCoversImports` below keeps the names honest.
//
// Node externals (apps/node/externals.ts), plus dependencies the terminal host externalizes. Other
// third-party packages are inside the corresponding bundle already.
const RUNTIME = [
  ...requiredRuntimePackages,
  // The terminal bundle leaves these Node-core imports external, even though the standalone service
  // bundle includes them. They are required beside the shared `acorn` launcher.
  'drizzle-orm',
  'hono',
]

// Loaded through `createRequire(...)` rather than a static import. The scanner below matches both
// spellings, so this list is a second check on the two that would break a boot. It looks for the bare
// name as a quoted string, which is weaker than the specifier scan and labelled as such rather than
// folded in silently.
const DYNAMIC = ['@xterm/headless', '@xterm/addon-serialize']

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

// Real import/require specifiers only. Deliberately narrow: a loose "any quoted string after the word
// import" pattern matches template literals and prose inside the bundle, and a scanner that reports
// `${startDir}` as a dependency is one nobody trusts enough to act on.
function importedPackages(files) {
  const found = new Set()
  const patterns = [
    // Static imports sit at the start of a line in Rolldown's output. Anchoring there matters since
    // third-party code is bundled: its doc comments are full of example lines such as
    // ` * import { Hono } from 'hono'`.
    /^(?:import|export)[^;'"]*?from\s*['"]([^'"]+)['"]/gm,
    /^import\s*['"]([^'"]+)['"]/gm,
    // The negative lookbehind is load-bearing: `agentProfileRegistry.require("shell")` is a method
    // named require, and without it the scanner reported `shell` as a missing dependency. A checker
    // that cries wolf on the first run is one whose next real finding gets waved through.
    //
    // There is no pattern for a bare `require("…")`. The output is ESM and has no `require` binding,
    // so every one in it is text: ajv's code generator writes them into strings. Bundled CommonJS
    // calls `__require` instead, and only for builtins and the optional native addons ws and pg can
    // do without, none of which belong in the manifest.
    /(?<![.\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // The dynamic forms, which are not an edge case here: @xterm/headless and @xterm/addon-serialize
    // are both loaded this way, because a lazy load turns a load failure into an actionable error
    // instead of a bare stack at import time. A scanner blind to them declares the manifest complete
    // and the unpacked tarball dies on `Cannot find module '@xterm/headless'` at boot. Rolldown
    // renames a binding that two modules share, so `nodeRequire` can arrive as `nodeRequire$1`, and
    // `.resolve` is how the Claude adapter's path is found.
    /(?<![.\w$])[A-Za-z_$][\w$]*Require(?:\$\d+)?(?:\.resolve)?\s*\(\s*['"]([^'"]+)['"]/g,
    /createRequire\([^)]*\)\s*\(\s*['"]([^'"]+)['"]/g,
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]
        if (specifier.includes('${')) continue // a template placeholder in a bundled error message
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') || builtinModules.includes(specifier)) continue
        found.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
      }
    }
  }
  return found
}

// The one runnable check in this script, and the failure it exists for is silent: a package the bundle
// imports but the manifest omits produces a tarball that installs cleanly and then throws
// ERR_MODULE_NOT_FOUND on the operator's machine, at boot, with no clue pointing back here.
function assertManifestCoversImports(distDir, runtime = RUNTIME) {
  const visit = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name)
    return entry.isDirectory() ? visit(file) : entry.name.endsWith('.js') ? [file] : []
  })
  const files = visit(distDir)
  const imported = importedPackages(files)
  const declared = new Set(runtime)
  const missing = [...imported].filter((name) => !declared.has(name))
  if (missing.length) {
    throw new Error(
      `The generated package.json is missing packages the artifact imports: ${missing.join(', ')}.\n` +
        'Add them to RUNTIME in scripts/pack-node.mjs (and to apps/desktop/package.json if they are new).',
    )
  }
  const bundled = files.map((file) => readFileSync(file, 'utf8')).join('\n')
  const missingDynamic = DYNAMIC.filter((name) => !bundled.includes(`'${name}'`) && !bundled.includes(`"${name}"`))
  if (missingDynamic.length) {
    throw new Error(`Expected a dynamic require of ${missingDynamic.join(', ')} in the artifact and found none.`)
  }
  return imported
}

function stageMigrations(target) {
  const chains = [
    ['', join(ROOT, 'packages/node-core/migrations')],
    ...readdirSync(join(ROOT, 'plugins'))
      .map((name) => [name, join(ROOT, 'plugins', name, 'migrations')])
      .filter(([, dir]) => existsSync(join(dir, 'meta/_journal.json'))),
  ]
  for (const [name, dir] of chains) cpSync(dir, name ? join(target, name) : target, { recursive: true })
  return chains.length
}

console.log('[pack-node] building the artifact')
execFileSync('pnpm', ['--filter', '@acorn/node', 'build'], { cwd: ROOT, stdio: 'inherit' })
execFileSync('pnpm', ['--filter', '@acorn/cli', 'build'], { cwd: ROOT, stdio: 'inherit' })
execFileSync('pnpm', ['--filter', '@acorn/tui', 'build'], { cwd: ROOT, stdio: 'inherit' })

const dist = join(NODE_APP, 'dist')
if (!existsSync(join(dist, 'standalone.js'))) throw new Error('apps/node/dist/standalone.js is missing after the build.')

const imported = assertManifestCoversImports(dist)
console.log(`[pack-node] artifact imports ${imported.size} packages, all declared`)

rmSync(OUT, { recursive: true, force: true })
const staging = join(OUT, 'acorn-node')
mkdirSync(staging, { recursive: true })
cpSync(dist, join(staging, 'dist'), { recursive: true })
cpSync(join(CLI_APP, 'dist'), join(staging, 'dist/cli'), { recursive: true })
cpSync(join(TUI_APP, 'dist'), join(staging, 'dist/tui'), { recursive: true })
mkdirSync(join(staging, 'bin'), { recursive: true })
cpSync(join(CLI_APP, 'bin/acorn.mjs'), join(staging, 'bin/acorn.mjs'))
const chains = stageMigrations(join(staging, 'migrations'))
console.log(`[pack-node] staged ${chains} migration chains`)

// Versions come from apps/desktop's manifest, the package that already pins them for the bundled node,
// so the standalone one cannot drift from it. `catalog:` entries are resolved out of pnpm-workspace.yaml,
// which is where the single-versioned packages live (a duplicate zod means schema instances that fail
// each other's instanceof checks, which is why they are pinned there in the first place).
const desktop = read(join(ROOT, 'apps/desktop/package.json'))
const tui = read(join(TUI_APP, 'package.json'))
const workspaceLines = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/)
const catalogStart = workspaceLines.indexOf('catalog:') + 1
if (catalogStart === 0) throw new Error('pnpm-workspace.yaml has no catalog section.')
const catalogEnd = workspaceLines.findIndex((line, index) => index >= catalogStart && /^[^\s#]/.test(line))
const catalog = Object.fromEntries(
  workspaceLines
    .slice(catalogStart, catalogEnd === -1 ? undefined : catalogEnd)
    .map((line) => /^\s{2}([@\w./-]+):\s*"([^"]+)"\s*$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => [match[1], match[2]]),
)

const dependencies = {}
const standaloneRuntime = new Set([...RUNTIME, ...Object.keys(tui.dependencies ?? {}).filter((name) => !name.startsWith('@acorn/'))])
for (const name of standaloneRuntime) {
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
assertManifestCoversImports(join(staging, 'dist'), standaloneRuntime)
console.log('[pack-node] service, CLI, and TUI runtime imports are declared')

writeFileSync(
  join(staging, 'package.json'),
  `${JSON.stringify(
    {
      name: 'acorn-node',
      version: desktop.version,
      private: true,
      type: 'module',
      // The entry an operator runs, and the one a launchd plist or systemd unit points at.
      main: 'dist/standalone.js',
      bin: { acorn: 'bin/acorn.mjs' },
      // --disable-warning: `node:sqlite` is still flagged experimental and prints a warning on every
      // require. It is accurate about the API's status and useless to an operator who did not choose
      // the storage engine, and it lands in the middle of the pairing banner. Scoped to this one
      // warning class rather than --no-warnings, so a real deprecation still gets through.
      scripts: { start: 'node --disable-warning=ExperimentalWarning dist/standalone.js' },
      // npm warns on a mismatch; plugin worker factories also enforce this security floor.
      engines: { node: NODE_ENGINES },
      dependencies,
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
    },
    null,
    2,
  )}\n`,
)

writeFileSync(
  join(staging, 'README.md'),
  [
    '# Acorn Node (standalone)',
    '',
    'A headless acorn node. The desktop app pairs with it over TLS and drives it exactly like its own',
    'bundled node.',
    '',
    '```sh',
    'npm install --omit=dev   # builds node-pty against THIS Node, if no prebuilt binary fits',
    'SESSION_ENC_KEY=$(openssl rand -hex 32) GITHUB_CLIENT_ID=<your oauth app> node dist/standalone.js',
    'node bin/acorn.mjs --help   # headless commands; no arguments open the terminal client',
    '```',
    '',
    'It prints one line of JSON when it is listening: the endpoint, the certificate fingerprint, the',
    'certificate itself and a device token. That line is the contract — the port is ephemeral, so nothing',
    'can guess it, and the self-signed certificate has no CA to vouch for it.',
    '',
    'Full setup, including launchd and systemd units and the security notes for exposing a node beyond',
    'loopback, is in the repository at `docs/node-distribution.md`.',
    '',
  ].join('\n'),
)

// `tar` rather than a packing library, for the same reason server/storage/backup.ts uses it: the platform has one,
// it is what the operator will unpack with, and a dependency for a single `-czf` is not worth it.
const archive = join(OUT, `acorn-node-${desktop.version}.tar.gz`)
execFileSync('tar', ['-czf', archive, '-C', OUT, 'acorn-node'], { stdio: 'inherit' })
rmSync(staging, { recursive: true, force: true })
console.log(`[pack-node] ${archive}`)
