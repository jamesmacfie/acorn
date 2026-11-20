import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

// The pinned Node runtime that rides in the bundle, fetched from nodejs.org and verified against the
// digests node-runtime.json pins for it (docs/shell/packaging.md § Build and packaging).
//
// Every machine and every CI run bundles the same verified bytes, so no developer has to switch
// runtimes to stage a build. A machine pays one download per pin, then hits the cache.

const CACHE = resolve(homedir(), '.cache/acorn/node-runtime')

// nodejs.org spells platforms and architectures its own way. Only the targets a bundle is built for are
// here. Windows publishes node.exe directly, so it needs no archive extractor.
const DIST_NAMES = new Map([
  ['aarch64-apple-darwin', 'darwin-arm64'],
  ['x86_64-apple-darwin', 'darwin-x64'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64'],
  ['x86_64-unknown-linux-gnu', 'linux-x64'],
  ['x86_64-pc-windows-msvc', 'win-x64'],
])

export const runtimeTarget = (triple) => {
  const dist = DIST_NAMES.get(triple)
  if (!dist) throw new Error(`Unsupported desktop target triple: ${triple}`)
  const [system, arch] = dist.split('-')
  return { triple, platform: system === 'win' ? 'win32' : system, arch }
}

export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

export const runtimeBinaryName = (triple) => `node-${triple}${triple.includes('-windows-') ? '.exe' : ''}`

/// The triple `bundle.externalBin` will look for. An explicit target wins, because a cross-compiled
/// build that silently bundled the host's Node would only fail on the machine that installed it.
export const targetTriple = () => {
  const explicit = process.env.ACORN_TARGET_TRIPLE?.trim()
  if (explicit) return explicit
  const host = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1]
  if (!host) throw new Error('Could not read the host target triple from `rustc -vV`.')
  return host
}

const download = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status} ${response.statusText}`)
  return Buffer.from(await response.arrayBuffer())
}

// Windows' own bsdtar, which reads zip archives and drive-letter paths. Git for Windows puts GNU tar
// first on a runner's PATH, and that one does neither.
export const tar = process.platform === 'win32' ? resolve(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe') : 'tar'

/// One nodejs.org file for the pin, checked against the digest `node-runtime.json` records for it. The
/// cache keeps the file itself, so a hit is checked against the same pinned digest as a download. A
/// digest written beside a cache entry, or a SHASUMS256.txt fetched from the same server, would only
/// prove the bytes agree with whoever supplied them.
const verifiedFile = async (pin, file, cacheDir) => {
  const expected = pin.sha256?.[file]
  if (!/^[0-9a-f]{64}$/.test(expected ?? '')) {
    throw new Error(`node-runtime.json has no reviewed sha256 for ${file}. Add it from the signed SHASUMS256.txt.asc for v${pin.version}.`)
  }
  const cached = resolve(cacheDir, `v${pin.version}`, file)
  if (existsSync(cached) && sha256(cached) === expected) return { path: cached, source: 'cache' }

  const url = `https://nodejs.org/dist/v${pin.version}/${file}`
  const bytes = await download(url)
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) throw new Error(`${url} failed its checksum: node-runtime.json pins ${expected}, the download hashes to ${actual}.`)
  // Written beside its final name, because a rename across filesystems fails with EXDEV, as /tmp and
  // the home folder are in the Linux archive jobs' container.
  mkdirSync(dirname(cached), { recursive: true })
  const partial = `${cached}.partial-${process.pid}`
  writeFileSync(partial, bytes)
  renameSync(partial, cached)
  return { path: cached, source: 'nodejs.org' }
}

/// Copies one member of a verified archive out under `name` in the cache, and answers its path. The
/// copy is written whole and then renamed, so an interrupted stage never leaves a truncated file behind.
const extracted = (archive, member, stripComponents, cacheDir, name) => {
  mkdirSync(cacheDir, { recursive: true })
  const scratch = mkdtempSync(resolve(cacheDir, '.scratch-runtime-'))
  try {
    execFileSync(tar, ['-xzf', archive, '-C', scratch, `--strip-components=${stripComponents}`, member])
    const target = resolve(cacheDir, name)
    rmSync(target, { force: true })
    renameSync(resolve(scratch, basename(member)), target)
    return target
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/// The `node` binary for the pin and this triple. It comes out of a verified archive on every call,
/// because an extracted binary has no published digest to check a cache hit against.
export const cachedRuntime = async (pin, triple, cacheDir = CACHE) => {
  const dist = DIST_NAMES.get(triple)
  if (!dist) throw new Error(`No nodejs.org build is mapped for ${triple}. Add it to DIST_NAMES, or set ACORN_TARGET_TRIPLE.`)
  // Windows publishes node.exe directly, so the verified file is the binary.
  if (triple.includes('-windows-')) return verifiedFile(pin, `${dist}/node.exe`, cacheDir)
  const root = `node-v${pin.version}-${dist}`
  const { path: archive, source } = await verifiedFile(pin, `${root}.tar.gz`, cacheDir)
  // Only the one file out of ~110 MB of runtime: the bundle ships a binary, not a Node installation.
  return { path: extracted(archive, `${root}/bin/node`, 2, cacheDir, `node-v${pin.version}-${triple}`), source }
}

/// Node's LICENSE for the pin, which a copy of the runtime has to carry. Every release archive holds the
/// same file and the headers tarball holds none, so it comes from the Linux x64 tarball for any target.
export const cachedLicense = async (pin, cacheDir = CACHE) => {
  const root = `node-v${pin.version}-linux-x64`
  const { path: archive } = await verifiedFile(pin, `${root}.tar.gz`, cacheDir)
  return extracted(archive, `${root}/LICENSE`, 1, cacheDir, `node-v${pin.version}-LICENSE`)
}

/// Put the pinned runtime where `bundle.externalBin` resolves it, and answer where that is.
export const stageNodeRuntime = async ({ pkg, pin, triple, cacheDir = CACHE }) => {
  const { path: runtime, source } = await cachedRuntime(pin, triple, cacheDir)
  const binary = resolve(pkg, 'src-tauri/binaries', runtimeBinaryName(triple))
  mkdirSync(dirname(binary), { recursive: true })
  // Removed before it is written, never overwritten in place. macOS caches a code signature against the
  // inode, so a `copyFileSync` over a runtime that has already run leaves the kernel refusing the new
  // bytes with "load code signature error 2" and SIGKILLing every launch — a bricked runtime with no
  // message, from a re-stage that looked like it worked.
  rmSync(binary, { force: true })
  copyFileSync(runtime, binary)
  chmodSync(binary, 0o755)
  return { binary, source }
}
