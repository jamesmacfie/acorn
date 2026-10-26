#!/usr/bin/env node
// Assemble a standalone Acorn Node tarball. See docs/node-distribution.md for what an operator does
// with the result.
//
// ## Why a tarball and not an npm package
//
// `apps/node` is `private`, every `@acorn/*` dependency is `workspace:*`, and the dependency that
// matters most, node-pty, is native. An `npx`-able package would need prebuilt binaries for every
// (platform, arch, Node ABI) triple, which is a release pipeline rather than a script. A tarball the
// operator unpacks and runs `npm ci --omit=dev` in compiles node-pty against their own Node,
// the same dance a developer already does here (`pnpm rebuild:node`).
//
// ## What goes in
//
//   dist/          the Node artifact plus cli/ and tui/ client bundles
//   bin/acorn.mjs  thin command-versus-terminal launcher
//   scripts/prune-runtime.mjs  run after `npm ci`: removes files no runtime loads, including the Claude
//                  SDK's bundled executable
//   migrations/    every Drizzle chain: core's at the root, each plugin's under its own name
//   plugins/       the desktop's bundled loaded plugins (scripts/bundled-plugins.mjs), which the Node
//                  reconciles into its data root on boot
//   package.json   generated, listing only the real runtime dependencies (see RUNTIME below)
//   package-lock.json  resolved at pack time, so every operator installs the same versions
//   README.md      pointing at docs/node-distribution.md
//
// ## Platform archives
//
// `--platform <os>-<arch>` writes a self-contained archive for this machine's platform instead: the
// tree above under lib/ with its dependencies installed and pruned, the pinned Node.js runtime under
// runtime/, and the launchers, installer, and README from scripts/node-archive/. The runner's own Node only
// installs packages. CI builds one per platform (.github/workflows/build-node.yml), on that platform,
// because node-pty takes a prebuild on macOS and Windows and compiles on Linux.
//
// The desktop renderer, the shell and every `@acorn/*` package are absent by construction: the
// builds bundle first-party source into the artifacts, so the archive needs none of them at runtime.

import { execFileSync, execSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cachedLicense, cachedRuntime, sha256, tar } from '../apps/desktop/scripts/node-runtime.mjs'
import { buildBundledPlugins } from './bundled-plugins.mjs'
import { externalSpecifiers, packageName, readChunkGraph } from './chunkGraph.mts'
import { requiredRuntimePackages } from './nodeRuntimePackages.ts'
import { REVIEWED_PACKAGES } from './prune-runtime.mjs'
import { runPnpm } from './run-pnpm.mjs'

// Each archive platform and the target triple its pinned runtime is cached under.
const ARCHIVE_TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
}
const { platform } = parseArgs({ options: { platform: { type: 'string' } } }).values
if (platform !== undefined && platform !== `${process.platform}-${process.arch}`) {
  throw new Error(
    `--platform ${platform} must be this machine's, ${process.platform}-${process.arch}, because npm installs node-pty's build for the machine it runs on.`,
  )
}
if (platform !== undefined && !ARCHIVE_TRIPLES[platform]) {
  throw new Error(`There is no archive for ${platform}. Archives cover ${Object.keys(ARCHIVE_TRIPLES).join(', ')}.`)
}

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

// Loaded through `createRequire(...)` rather than an import, and the two that would break a boot if
// the manifest missed them. The build's graph must list both, or its require detection has gone blind
// (scripts/chunkGraph.mts § requiredSpecifiers).
const DYNAMIC = ['@xterm/headless', '@xterm/addon-serialize']

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
// Through a shell, because Windows runs npm as npm.cmd, which execFile can't start. Every argument is
// this script's own.
const npm = (args, cwd) => execSync(`npm ${args.join(' ')}`, { cwd, stdio: 'inherit' })

// The one runnable check in this script, and the failure it exists for is silent: a package the bundle
// imports but the manifest omits produces a tarball that installs cleanly and then throws
// ERR_MODULE_NOT_FOUND on the operator's machine, at boot, with no clue pointing back here.
//
// It reads the chunk graph each build writes rather than the bundle text, because both bundles are
// minified: one line holds many imports, and a require is called through whatever name the minifier
// chose. The CLI bundle leaves only Node builtins external (apps/cli/vite.config.ts), so it has nothing
// to check.
function assertManifestCoversImports(distDir, runtime) {
  const graph = readChunkGraph(distDir)
  const { atLoad, onFirstUse, required } = externalSpecifiers(graph, Object.keys(graph.chunks))
  const imported = new Set([...atLoad, ...onFirstUse, ...required].map(packageName))
  const missing = [...imported].filter((name) => !runtime.has(name))
  if (missing.length) {
    throw new Error(
      `The generated package.json is missing packages ${distDir} imports: ${missing.join(', ')}.\n` +
        'Add them to RUNTIME in scripts/pack-node.mjs (and to apps/desktop/package.json if they are new).',
    )
  }
  return { imported, required }
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
runPnpm(['--filter', '@acorn/node', 'build'], { cwd: ROOT, stdio: 'inherit' })
runPnpm(['--filter', '@acorn/cli', 'build'], { cwd: ROOT, stdio: 'inherit' })
runPnpm(['--filter', '@acorn/tui', 'build'], { cwd: ROOT, stdio: 'inherit' })

const dist = join(NODE_APP, 'dist')
if (!existsSync(join(dist, 'standalone.js'))) throw new Error('apps/node/dist/standalone.js is missing after the build.')

const { imported, required } = assertManifestCoversImports(dist, new Set(RUNTIME))
const missingDynamic = DYNAMIC.filter((name) => !required.has(name))
if (missingDynamic.length) {
  throw new Error(`Expected the service graph to list a createRequire of ${missingDynamic.join(', ')} and found none.`)
}
console.log(`[pack-node] artifact imports ${imported.size} packages, all declared`)

rmSync(OUT, { recursive: true, force: true })
const staging = join(OUT, 'acorn-node')
mkdirSync(staging, { recursive: true })
// The chunk graphs and source maps are build metadata. The maps stay in each app's dist for reading a
// packaged stack (docs/local-development/packaged-stacks.md § Find the source line).
const runnable = { recursive: true, filter: (path) => !path.endsWith('.map') && !path.endsWith('startup-graph.json') }
cpSync(dist, join(staging, 'dist'), runnable)
cpSync(join(CLI_APP, 'dist'), join(staging, 'dist/cli'), runnable)
cpSync(join(TUI_APP, 'dist'), join(staging, 'dist/tui'), runnable)
mkdirSync(join(staging, 'bin'), { recursive: true })
cpSync(join(CLI_APP, 'bin/acorn.mjs'), join(staging, 'bin/acorn.mjs'))
mkdirSync(join(staging, 'scripts'), { recursive: true })
cpSync(join(ROOT, 'scripts/prune-runtime.mjs'), join(staging, 'scripts/prune-runtime.mjs'))
const chains = stageMigrations(join(staging, 'migrations'))
console.log(`[pack-node] staged ${chains} migration chains`)
const plugins = buildBundledPlugins(join(staging, 'plugins'))
console.log(`[pack-node] staged ${plugins.length} bundled plugins`)

// Versions come from apps/desktop's manifest, the package that already pins them for the bundled node,
// so the standalone one cannot drift from it. `catalog:` entries are resolved out of pnpm-workspace.yaml,
// which is where the single-versioned packages live (a duplicate zod means schema instances that fail
// each other's instanceof checks, which is why they are pinned there in the first place).
const desktop = read(join(ROOT, 'apps/desktop/package.json'))
const tui = read(join(TUI_APP, 'package.json'))
const workspaceText = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
const workspaceLines = workspaceText.split(/\r?\n/)
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
// The install prunes against exact reviewed versions and refuses any other, so lock those versions here.
// The adapter pins its SDK exactly, which covers the one reviewed package that isn't direct.
for (const [name, { version }] of Object.entries(REVIEWED_PACKAGES)) {
  if (Object.hasOwn(dependencies, name)) dependencies[name] = version
}
// The terminal's Markdown renderer imports mermaid on first use and leaves a diagram as code when it is
// absent (packages/client-core/src/kit/lib/rendering/mermaid.ts). The standalone install leaves it out.
// @openuidev/lang-core imports ci-info inside a try and reports "not in CI" when it's missing, so it stays out too.
assertManifestCoversImports(join(TUI_APP, 'dist'), new Set([...standaloneRuntime, 'mermaid', 'ci-info']))
console.log('[pack-node] service and TUI runtime imports are declared')

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

// Resolve the tree once, here, so every operator installs the same versions and npm checks each
// download against the hash recorded now. `--before` applies pnpm's minimumReleaseAge, so a version
// published within that window can't enter the lockfile.
const minimumReleaseAge = Number(/^minimumReleaseAge: (\d+)$/m.exec(workspaceText)?.[1])
if (!minimumReleaseAge) throw new Error('pnpm-workspace.yaml has no minimumReleaseAge.')
const before = new Date(Date.now() - minimumReleaseAge * 60_000).toISOString()
npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', `--before=${before}`], staging)
console.log(`[pack-node] locked the runtime dependencies to releases before ${before}`)

writeFileSync(
  join(staging, 'README.md'),
  [
    '# Acorn Node (standalone)',
    '',
    'A headless acorn node. The desktop app and the `acorn` terminal client pair with it over TLS and drive',
    'it like their own node.',
    '',
    'Claude Code agents need the `claude` command installed on this machine and on its PATH. The node',
    'never downloads it.',
    '',
    '```sh',
    'npm ci --omit=dev   # installs the locked versions; builds node-pty against THIS Node if no prebuilt fits',
    'node scripts/prune-runtime.mjs   # removes files no runtime loads, including the SDK\'s Claude executable',
    'ACORN_DATA_DIR=<a folder for its data> node dist/standalone.js',
    'node bin/acorn.mjs --help   # headless commands; no arguments open the terminal client',
    '```',
    '',
    'On its first start the node makes its keys and keeps them in its data folder. It prints one line of',
    'JSON with its address and certificate, then a banner with the address, six identity words, and a',
    'pairing code. Pair a client with that code. The output carries no device token, so a service manager',
    'can keep it in a log.',
    '',
    'Under a service manager, run the node through the CLI instead, so the CLI holds its token. It stays in',
    'the foreground, forwards SIGTERM, and drains on `acorn node stop`, on Windows too. Add `--log FILE` for',
    'launchd or Windows, which do not rotate logs. Open a pairing code with `acorn node pair`:',
    '',
    '```sh',
    'ACORN_DATA_DIR=<a folder for its data> node bin/acorn.mjs node start --foreground',
    'ACORN_DATA_DIR=<the same folder> node bin/acorn.mjs node pair',
    '```',
    '',
    'Setup, operations, and the security notes for exposing a node beyond loopback are in the repository',
    'at `docs/node-distribution.md`.',
    '',
  ].join('\n'),
)

// The steps docs/node-distribution.md § Install and start gives an operator, done here on the platform
// the archive is for, so the target machine needs no npm or compiler.
async function packPlatformArchive(tree) {
  const name = `acorn-node-${desktop.version}-${platform}`
  const root = join(OUT, name)
  const lib = join(root, 'lib')
  mkdirSync(root)
  renameSync(tree, lib)
  npm(['ci', '--omit=dev', '--no-audit', '--no-fund'], lib)
  execFileSync(process.execPath, ['scripts/prune-runtime.mjs'], { cwd: lib, stdio: 'inherit' })
  // Its steps are the ones this function has already run. The archive's own README replaces it.
  rmSync(join(lib, 'README.md'))
  // node-pty publishes spawn-helper as mode 644, and a terminal fails with "posix_spawnp failed"
  // until it's executable. tar keeps the mode from here on.
  const spawnHelper = join(lib, 'node_modules/node-pty/prebuilds', platform, 'spawn-helper')
  if (existsSync(spawnHelper)) chmodSync(spawnHelper, 0o755)

  const windows = platform.startsWith('win32')
  const pin = read(join(ROOT, 'node-runtime.json')).version
  const runtime = await cachedRuntime(pin, ARCHIVE_TRIPLES[platform])
  mkdirSync(join(root, 'runtime'))
  const node = join(root, 'runtime', windows ? 'node.exe' : 'node')
  cpSync(runtime.path, node)
  chmodSync(node, 0o755)
  cpSync(await cachedLicense(pin), join(root, 'runtime/LICENSE'))
  console.log(`[pack-node] Node.js ${pin} for ${platform}, from ${runtime.source}`)

  const launchers = join(ROOT, 'scripts/node-archive')
  mkdirSync(join(root, 'bin'))
  cpSync(join(launchers, 'acorn'), join(root, 'bin/acorn'))
  chmodSync(join(root, 'bin/acorn'), 0o755)
  cpSync(join(launchers, 'acorn.cmd'), join(root, 'bin/acorn.cmd'))
  cpSync(join(launchers, 'README.md'), join(root, 'README.md'))
  const installer = windows ? 'install.ps1' : 'install.sh'
  cpSync(join(launchers, installer), join(root, installer))
  if (!windows) chmodSync(join(root, installer), 0o755)
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  writeFileSync(
    join(root, 'BUILD'),
    `version=${desktop.version}\ncommit=${commit}\nbuilt=${new Date().toISOString()}\nplatform=${platform}\nnode=${pin}\n`,
  )

  // A zip on Windows, where people extract with Explorer. A tarball elsewhere, because it keeps the
  // executable bits that bin/acorn, the runtime, and spawn-helper need.
  const archive = join(OUT, `${name}${windows ? '.zip' : '.tar.gz'}`)
  execFileSync(tar, [...(windows ? ['-a', '-cf'] : ['-czf']), archive, '-C', OUT, name], { stdio: 'inherit' })
  writeFileSync(`${archive}.sha256`, `${sha256(archive)}  ${basename(archive)}\n`)
  rmSync(root, { recursive: true, force: true })
  return archive
}

let archive
if (platform) archive = await packPlatformArchive(staging)
else {
  // `tar` rather than a packing library, for the same reason server/storage/backup.ts uses it: the platform has one,
  // it is what the operator will unpack with, and a dependency for a single `-czf` is not worth it.
  archive = join(OUT, `acorn-node-${desktop.version}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', OUT, 'acorn-node'], { stdio: 'inherit' })
  rmSync(staging, { recursive: true, force: true })
}
console.log(`[pack-node] ${archive}`)
