import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedLicense, cachedRuntime, runtimeBinaryName, stageNodeRuntime, tar } from './node-runtime.mjs'

const VERSION = '24.21.0'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

const scratch = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-runtime-test-'))
  scratch.push(dir)
  return dir
}

/// A fake nodejs.org that serves `files` by name, plus a SHASUMS256.txt that vouches for whatever it
/// serves, the way a compromised server would.
function serve(files) {
  const shasums = Object.entries(files).map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join('')
  const fetch = vi.fn(async (url) => {
    const name = url.replace(`https://nodejs.org/dist/v${VERSION}/`, '')
    if (name === 'SHASUMS256.txt') return new Response(shasums)
    return files[name] ? new Response(files[name]) : new Response('missing', { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function windowsFixture() {
  const dir = tempDir()
  const bytes = Buffer.from('verified Windows Node fixture')
  const pin = { version: VERSION, sha256: { 'win-x64/node.exe': digest(bytes) } }
  return { options: { pkg: dir, cacheDir: join(dir, 'cache'), pin, triple: 'x86_64-pc-windows-msvc' }, bytes }
}

describe('pinned Windows runtime', () => {
  it('downloads the pinned executable once and stages the Tauri sidecar name', async () => {
    const { options, bytes } = windowsFixture()
    const fetch = serve({ 'win-x64/node.exe': bytes })
    const result = await stageNodeRuntime(options)
    expect(result.binary).toBe(join(options.pkg, 'src-tauri/binaries/node-x86_64-pc-windows-msvc.exe'))
    expect(readFileSync(result.binary)).toEqual(bytes)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([`https://nodejs.org/dist/v${VERSION}/win-x64/node.exe`])
    await expect(stageNodeRuntime(options)).resolves.toMatchObject({ source: 'cache' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refuses bytes the pin does not name, even when the server publishes a checksum for them', async () => {
    const { options } = windowsFixture()
    serve({ 'win-x64/node.exe': Buffer.from('replaced runtime') })
    await expect(stageNodeRuntime(options)).rejects.toThrow('failed its checksum: node-runtime.json pins')
    expect(existsSync(join(options.pkg, 'src-tauri/binaries'))).toBe(false)
    expect(existsSync(join(options.cacheDir, `v${VERSION}/win-x64/node.exe`))).toBe(false)
  })

  it('downloads again when the cached executable was altered', async () => {
    const { options, bytes } = windowsFixture()
    const fetch = serve({ 'win-x64/node.exe': bytes })
    await stageNodeRuntime(options)
    writeFileSync(join(options.cacheDir, `v${VERSION}/win-x64/node.exe`), 'altered')
    const result = await stageNodeRuntime(options)
    expect(result.source).toBe('nodejs.org')
    expect(readFileSync(result.binary)).toEqual(bytes)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('refuses an altered cache entry when the server serves the same altered bytes', async () => {
    const { options } = windowsFixture()
    const altered = Buffer.from('altered')
    mkdirSync(join(options.cacheDir, `v${VERSION}/win-x64`), { recursive: true })
    writeFileSync(join(options.cacheDir, `v${VERSION}/win-x64/node.exe`), altered)
    serve({ 'win-x64/node.exe': altered })
    await expect(stageNodeRuntime(options)).rejects.toThrow('failed its checksum')
    expect(existsSync(join(options.pkg, 'src-tauri/binaries'))).toBe(false)
  })

  it('refuses a target the pin records no digest for', async () => {
    const { options, bytes } = windowsFixture()
    const fetch = serve({ 'win-x64/node.exe': bytes })
    await expect(stageNodeRuntime({ ...options, pin: { version: VERSION, sha256: {} } })).rejects.toThrow('no reviewed sha256 for win-x64/node.exe')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps Unix sidecar names without an executable extension', () => {
    expect(runtimeBinaryName('aarch64-apple-darwin')).toBe('node-aarch64-apple-darwin')
    expect(runtimeBinaryName('x86_64-unknown-linux-gnu')).toBe('node-x86_64-unknown-linux-gnu')
  })
})

describe('pinned Unix runtime', () => {
  /// A real tar.gz laid out like a nodejs.org release archive.
  function tarball(root, contents) {
    const dir = tempDir()
    mkdirSync(join(dir, root, 'bin'), { recursive: true })
    writeFileSync(join(dir, root, 'bin/node'), contents.node)
    writeFileSync(join(dir, root, 'LICENSE'), contents.license)
    // The script's own tar: on Windows, the GNU tar first on PATH reads `C:` in a path as a remote host.
    execFileSync(tar, ['-czf', join(dir, 'archive.tar.gz'), '-C', dir, root])
    return readFileSync(join(dir, 'archive.tar.gz'))
  }

  it('extracts the binary and LICENSE from the verified archive, and checks the cached archive again', async () => {
    const cacheDir = join(tempDir(), 'cache')
    const darwin = tarball(`node-v${VERSION}-darwin-arm64`, { node: 'darwin node', license: 'darwin license' })
    const linux = tarball(`node-v${VERSION}-linux-x64`, { node: 'linux node', license: 'Node license' })
    const files = { [`node-v${VERSION}-darwin-arm64.tar.gz`]: darwin, [`node-v${VERSION}-linux-x64.tar.gz`]: linux }
    const pin = { version: VERSION, sha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])) }
    const fetch = serve(files)

    const first = await cachedRuntime(pin, 'aarch64-apple-darwin', cacheDir)
    expect(first.source).toBe('nodejs.org')
    expect(readFileSync(first.path, 'utf8')).toBe('darwin node')
    expect(readFileSync(await cachedLicense(pin, cacheDir), 'utf8')).toBe('Node license')

    // An extracted binary replaced in the cache is overwritten from the archive, which is checked first.
    writeFileSync(first.path, 'altered node')
    const again = await cachedRuntime(pin, 'aarch64-apple-darwin', cacheDir)
    expect(again.source).toBe('cache')
    expect(readFileSync(again.path, 'utf8')).toBe('darwin node')
    expect(fetch).toHaveBeenCalledTimes(2)

    // A cached archive replaced with one the server also vouches for fails.
    const altered = tarball(`node-v${VERSION}-darwin-arm64`, { node: 'altered node', license: 'x' })
    writeFileSync(join(cacheDir, `v${VERSION}/node-v${VERSION}-darwin-arm64.tar.gz`), altered)
    serve({ ...files, [`node-v${VERSION}-darwin-arm64.tar.gz`]: altered })
    await expect(cachedRuntime(pin, 'aarch64-apple-darwin', cacheDir)).rejects.toThrow('failed its checksum')
  })
})

describe('node-runtime.json', () => {
  const pin = JSON.parse(readFileSync(new URL('../../../node-runtime.json', import.meta.url), 'utf8'))
  const triples = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'aarch64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu', 'x86_64-pc-windows-msvc']

  // Bytes that match no real digest, so each call reaches the pinned digest and stops there. A missing
  // digest fails earlier, with a different message.
  it.each(triples)('records a reviewed digest for the %s runtime', async (triple) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not node')))
    await expect(cachedRuntime(pin, triple, join(tempDir(), 'cache'))).rejects.toThrow(`failed its checksum: node-runtime.json pins`)
  })

  it('records a reviewed digest for the archive the LICENSE comes from', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not node')))
    await expect(cachedLicense(pin, join(tempDir(), 'cache'))).rejects.toThrow(`failed its checksum: node-runtime.json pins`)
  })
})
