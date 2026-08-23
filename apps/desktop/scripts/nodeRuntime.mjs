import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

// The pinned Node runtime that rides in the bundle, fetched from nodejs.org and verified against that
// release's SHASUMS256.txt (docs/shell.md § Build and packaging).
//
// Phase 2 copied whichever Node was running the staging script, which was enough for a developer build
// and refused to run when the developer's runtime was not the pinned one. There is one path now, and it
// is the release path: every machine and every CI run bundles the same bytes, verified, and no developer
// has to switch runtimes to stage a build. A machine pays one download per pin, then hits the cache.

const CACHE = resolve(homedir(), '.cache/acorn/node-runtime')

// nodejs.org spells platforms and architectures its own way. Only the targets a bundle is built for are
// here; a Windows target needs the .zip layout and node.exe, which is out of scope for v1.
const DIST_NAMES = new Map([
  ['aarch64-apple-darwin', 'darwin-arm64'],
  ['x86_64-apple-darwin', 'darwin-x64'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64'],
  ['x86_64-unknown-linux-gnu', 'linux-x64'],
])

export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

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

/// The extracted `node` binary for this version and triple, from the cache when it is there and intact.
/// The cache records the digest of the extracted binary rather than the tarball's, so a hit re-verifies
/// without going back to the network.
const cachedRuntime = async (version, triple) => {
  const dist = DIST_NAMES.get(triple)
  if (!dist) throw new Error(`No nodejs.org build is mapped for ${triple}. Add it to DIST_NAMES, or set ACORN_TARGET_TRIPLE.`)
  const cached = resolve(CACHE, `node-v${version}-${triple}`)
  const digestFile = `${cached}.sha256`
  if (existsSync(cached) && existsSync(digestFile) && sha256(cached) === readFileSync(digestFile, 'utf8').trim()) {
    return { path: cached, source: 'cache' }
  }

  const archive = `node-v${version}-${dist}.tar.gz`
  const base = `https://nodejs.org/dist/v${version}`
  const [shasums, tarball] = await Promise.all([download(`${base}/SHASUMS256.txt`), download(`${base}/${archive}`)])

  // The whole point of the exercise: the bytes that go into the bundle are the bytes nodejs.org
  // published for this release, not whatever a proxy or a half-finished download handed back.
  const expected = shasums
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archive)?.[0]
  if (!expected) throw new Error(`${base}/SHASUMS256.txt does not list ${archive}. Check the pin in node-runtime.json.`)
  const actual = createHash('sha256').update(tarball).digest('hex')
  if (actual !== expected) throw new Error(`${archive} failed its checksum: nodejs.org published ${expected}, the download hashes to ${actual}.`)

  const scratch = mkdtempSync(resolve(tmpdir(), 'acorn-node-runtime-'))
  try {
    const local = resolve(scratch, archive)
    writeFileSync(local, tarball)
    // Only the one file out of ~110 MB of runtime: the bundle ships a binary, not a Node installation.
    execFileSync('tar', ['-xzf', local, '-C', scratch, '--strip-components=2', `node-v${version}-${dist}/bin/node`])
    const extracted = resolve(scratch, 'node')
    mkdirSync(CACHE, { recursive: true })
    // Written under its final name only once it is whole, so an interrupted stage cannot leave a
    // truncated runtime behind that the next run would trust.
    rmSync(cached, { force: true })
    renameSync(extracted, cached)
    writeFileSync(digestFile, sha256(cached))
    return { path: cached, source: 'nodejs.org' }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/// Put the pinned runtime where `bundle.externalBin` resolves it, and answer where that is.
export const stageNodeRuntime = async ({ pkg, version, triple }) => {
  const { path: runtime, source } = await cachedRuntime(version, triple)
  const binary = resolve(pkg, 'src-tauri/binaries', `node-${triple}`)
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
