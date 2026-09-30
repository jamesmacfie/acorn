import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runtimeBinaryName, stageNodeRuntime } from './node-runtime.mjs'

const scratch = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function windowsDownload(checksum) {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-runtime-test-'))
  scratch.push(dir)
  const bytes = Buffer.from('verified Windows Node fixture')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const fetch = vi.fn(async (url) => new Response(url.endsWith('SHASUMS256.txt')
    ? `${checksum ?? digest}  win-x64/node.exe\n`
    : bytes))
  vi.stubGlobal('fetch', fetch)
  return { options: { pkg: dir, cacheDir: join(dir, 'cache'), version: '24.21.0', triple: 'x86_64-pc-windows-msvc' }, fetch, bytes }
}

describe('pinned Windows runtime', () => {
  it('downloads the checksum-listed executable and stages the Tauri sidecar name', async () => {
    const { options, fetch, bytes } = windowsDownload()
    const result = await stageNodeRuntime(options)
    expect(result.binary).toBe(join(options.pkg, 'src-tauri/binaries/node-x86_64-pc-windows-msvc.exe'))
    expect(readFileSync(result.binary)).toEqual(bytes)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://nodejs.org/dist/v24.21.0/SHASUMS256.txt',
      'https://nodejs.org/dist/v24.21.0/win-x64/node.exe',
    ])
    await expect(stageNodeRuntime(options)).resolves.toMatchObject({ source: 'cache' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('refuses unverified bytes without staging a binary', async () => {
    const { options } = windowsDownload('0'.repeat(64))
    await expect(stageNodeRuntime(options)).rejects.toThrow('failed its checksum')
    expect(existsSync(join(options.pkg, 'src-tauri/binaries'))).toBe(false)
  })

  it('downloads again when the cached executable was altered', async () => {
    const { options, fetch, bytes } = windowsDownload()
    await stageNodeRuntime(options)
    writeFileSync(join(options.cacheDir, `node-v${options.version}-${options.triple}`), 'damaged')
    const result = await stageNodeRuntime(options)
    expect(result.source).toBe('nodejs.org')
    expect(readFileSync(result.binary)).toEqual(bytes)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('keeps Unix sidecar names without an executable extension', () => {
    expect(runtimeBinaryName('aarch64-apple-darwin')).toBe('node-aarch64-apple-darwin')
    expect(runtimeBinaryName('x86_64-unknown-linux-gnu')).toBe('node-x86_64-unknown-linux-gnu')
  })
})
