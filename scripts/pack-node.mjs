#!/usr/bin/env node
// Assemble a standalone Acorn Node tarball (docs/vNext/plan.md § Phase 5: "standalone node distribution
// (`npx`/tarball + launchd/systemd notes) for remote machines"). See docs/node-distribution.md for what
// an operator does with the result.
//
// ## Why a tarball and not an npm package
//
// `apps/node` is `private`, every `@acorn/*` dependency is `workspace:*`, and the dependency that
// matters most — node-pty — is NATIVE. An `npx`-able package would need prebuilt
// binaries for every (platform, arch, Node ABI) triple we are willing to support, which is a release
// pipeline rather than a script. A tarball the operator unpacks and runs `npm install --omit=dev` in
// compiles it against THEIR Node, which is the same dance a developer already does here
// (`pnpm rebuild:node`) and needs no infrastructure at all.
//
// ## What goes in
//
//   dist/          the built artifact — standalone.js, mcp.js and the shared chunks
//   migrations/    every Drizzle chain: core's at the root, each plugin's under its own name
//   package.json   generated, listing ONLY the real runtime dependencies (see RUNTIME below)
//   README.md      pointing at docs/node-distribution.md
//
// The renderer, the Electron main process and every `@acorn/*` package are absent by construction: the
// build bundles first-party source into the artifact, so a node needs none of them at runtime.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NODE_APP = join(ROOT, 'apps/node')
const OUT = join(ROOT, 'apps/node/release')

// The runtime dependency set, and the one hand-maintained list in this script. Versions are read from
// apps/desktop's manifest rather than repeated here — it is the package that already pins them for the
// bundled node, so a divergence between the packaged app and the standalone one is impossible by
// construction. `assertManifestCoversImports` below is what keeps the NAMES honest.
const RUNTIME = [
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/sdk',
  '@anthropic-ai/sdk',
  '@hono/node-server',
  '@modelcontextprotocol/sdk',
  '@vscode/ripgrep',
  '@xterm/addon-serialize',
  '@xterm/headless',
  'drizzle-orm',
  'hono',
  'jose',
  'node-pty',
  'openai',
  'pg',
  'smol-toml',
  'ws',
  'zod',
]

// Loaded through `createRequire(...)` rather than a static import. The scanner below matches both
// spellings of that, so this list is a BELT-AND-BRACES check on the two that would break a boot — asserted by looking for the bare name as a quoted string,
// which is weaker than the specifier scan and labelled as such rather than folded in silently.
const DYNAMIC = ['@xterm/headless', '@xterm/addon-serialize']

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

// Real import/require specifiers only. Deliberately narrow: a loose "any quoted string after the word
// import" pattern matches template literals and prose inside the bundle, and a scanner that reports
// `${startDir}` as a dependency is one nobody trusts enough to act on.
function importedPackages(files) {
  const found = new Set()
  const patterns = [
    /(?:^|[\s;}])(?:import|export)[^;'"]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
    // The negative lookbehind is load-bearing: `agentProfileRegistry.require("shell")` is a METHOD named
    // require, and without it the scanner reported `shell` as a missing dependency. A checker that cries
    // wolf on the first run is one whose next real finding gets waved through.
    /(?<![.\w$])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?<![.\w$])require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // The dynamic forms, and they are NOT an edge case here: @xterm/headless and
    // @xterm/addon-serialize are both loaded this way, because a lazy load turns a load failure
    // into an actionable error instead of a bare stack at import time. The first
    // version of this scanner saw none of them — it declared the manifest complete, and the unpacked
    // tarball then died on `Cannot find module '@xterm/headless'` at boot. That is precisely the silent
    // failure this check exists for, so it now covers both spellings.
    /(?<![.\w$])[A-Za-z_$][\w$]*Require\s*\(\s*['"]([^'"]+)['"]/g,
    /createRequire\([^)]*\)\s*\(\s*['"]([^'"]+)['"]/g,
  ]
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1]
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue
        found.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
      }
    }
  }
  return found
}

// The one runnable check in this script, and the failure it exists for is silent: a package the bundle
// imports but the manifest omits produces a tarball that installs cleanly and then throws
// ERR_MODULE_NOT_FOUND on the operator's machine, at boot, with no clue pointing back here.
function assertManifestCoversImports(distDir) {
  const files = [
    ...readdirSync(distDir).filter((name) => name.endsWith('.js')).map((name) => join(distDir, name)),
    ...(existsSync(join(distDir, 'chunks'))
      ? readdirSync(join(distDir, 'chunks')).map((name) => join(distDir, 'chunks', name))
      : []),
  ]
  const imported = importedPackages(files)
  const declared = new Set(RUNTIME)
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

const dist = join(NODE_APP, 'dist')
if (!existsSync(join(dist, 'standalone.js'))) throw new Error('apps/node/dist/standalone.js is missing after the build.')

const imported = assertManifestCoversImports(dist)
console.log(`[pack-node] artifact imports ${imported.size} packages, all declared`)

rmSync(OUT, { recursive: true, force: true })
const staging = join(OUT, 'acorn-node')
mkdirSync(staging, { recursive: true })
cpSync(dist, join(staging, 'dist'), { recursive: true })
const chains = stageMigrations(join(staging, 'migrations'))
console.log(`[pack-node] staged ${chains} migration chains`)

// Versions come from apps/desktop's manifest — the package that already pins them for the BUNDLED node,
// so the standalone one cannot drift from it. `catalog:` entries are resolved out of pnpm-workspace.yaml,
// which is where the single-versioned packages live (a duplicate zod means schema instances that fail
// each other's instanceof checks, which is why they are pinned there in the first place).
const desktop = read(join(ROOT, 'apps/desktop/package.json'))
const catalog = Object.fromEntries(
  readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
    .split(/\r?\n/)
    .map((line) => /^\s{2}([@\w./-]+):\s*"([^"]+)"\s*$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => [match[1], match[2]]),
)

const dependencies = {}
for (const name of RUNTIME) {
  const declared = desktop.dependencies?.[name]
  if (!declared) throw new Error(`${name} is in RUNTIME but not in apps/desktop's dependencies.`)
  const version = declared === 'catalog:' ? catalog[name] : declared
  if (!version) throw new Error(`${name} is declared as 'catalog:' but pnpm-workspace.yaml has no entry for it.`)
  dependencies[name] = version
}

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
      // --disable-warning: `node:sqlite` is still flagged experimental and prints a warning on every
      // require. It is accurate about the API's status and useless to an operator who did not choose
      // the storage engine, and it lands in the middle of the pairing banner. Scoped to this one
      // warning class rather than --no-warnings, so a real deprecation still gets through.
      scripts: { start: 'node --disable-warning=ExperimentalWarning dist/standalone.js' },
      // The real floor is the node:sqlite surface main/sqlite.ts touches: enableForeignKeyConstraints
      // landed in 22.18/24.4, backup() and setReturnArrays earlier. npm only warns on a mismatch, but
      // a warning that names the requirement beats "unknown option" from deep inside boot.
      engines: { node: '>=22.18 <23 || >=24.4' },
      dependencies,
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

// `tar` rather than a packing library, for the same reason main/backup.ts uses it: the platform has one,
// it is what the operator will unpack with, and a dependency for a single `-czf` is not worth it.
const archive = join(OUT, `acorn-node-${desktop.version}.tar.gz`)
execFileSync('tar', ['-czf', archive, '-C', OUT, 'acorn-node'], { stdio: 'inherit' })
rmSync(staging, { recursive: true, force: true })
console.log(`[pack-node] ${archive}`)
