import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compareVersions,
  installPlugin,
  lockfilePath,
  pluginInstallRoot,
  readLockfile,
  sweepDebris,
  uninstallPlugin,
  updatePlugin,
  type PluginLockfile,
} from './pluginInstaller'
import { PLUGIN_API_MAJOR } from './pluginManifest'
import { pluginDbPath } from './pluginStorage'

// The installer's whole job is to turn bytes from somewhere else into a directory under the data root,
// so these tests build real tarballs with real tar and hand them over real (stubbed) fetches. A fixture
// archive committed to the repo would test the unpacking of one archive shape forever.

let root = ''
let workshop = ''

const manifest = (over: Record<string, unknown> = {}) => ({
  id: 'ntfy',
  name: 'ntfy plugin',
  version: '1.0.0',
  apiVersion: PLUGIN_API_MAJOR,
  node: './dist/node.js',
  client: './dist/client.js',
  ...over,
})

/** Lay a plugin package out in a fresh directory and return its path. */
function packageDir(contents: Record<string, unknown> = {}, layout: (dir: string) => void = () => {}): string {
  const dir = mkdtempSync(join(workshop, 'pkg-'))
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'acorn-plugin.json'), JSON.stringify(manifest(contents)))
  writeFileSync(join(dir, 'dist', 'node.js'), 'export default { name: "ntfy", init: () => {} }\n')
  writeFileSync(join(dir, 'dist', 'client.js'), 'export function activate() {}\n')
  layout(dir)
  return dir
}

/** tar the directory's CONTENTS at the archive root, which is what `tar -czf x.tgz -C dir .` produces. */
function tarball(dir: string, { nested = false }: { nested?: boolean } = {}): Buffer {
  const out = join(mkdtempSync(join(workshop, 'tar-')), 'package.tgz')
  // `nested` reproduces an npm tarball, where everything sits under one `package/` prefix.
  if (nested) execFileSync('/usr/bin/tar', ['-czf', out, '-C', join(dir, '..'), dir.split('/').pop()!])
  else execFileSync('/usr/bin/tar', ['-czf', out, '-C', dir, '.'])
  return readFileSync(out)
}

/** One fetch stub answering a single URL with these bytes. */
function serve(bytes: Buffer, url = 'https://example.test/acorn-plugin.tgz'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const asked = String(input)
      if (asked !== url) throw new Error(`unexpected fetch: ${asked}`)
      return new Response(new Uint8Array(bytes), { status: 200 })
    }),
  )
}

beforeEach(() => {
  // A space in the path on purpose, matching pluginLoader.test.ts: every path this module builds ends
  // up in an argv or a rename, and quoting mistakes only show up on input like this.
  root = mkdtempSync(join(tmpdir(), 'acorn install-'))
  workshop = mkdtempSync(join(tmpdir(), 'acorn workshop-'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
  rmSync(workshop, { recursive: true, force: true })
})

describe('resolving a source', () => {
  it('installs from a direct tarball URL, pinning the archive hash and entrypoint hashes', async () => {
    const bytes = tarball(packageDir())
    serve(bytes)
    const result = await installPlugin(root, { url: 'https://example.test/acorn-plugin.tgz' })

    expect(result).toEqual({ id: 'ntfy', version: '1.0.0', state: 'installed-restart-required' })
    expect(existsSync(join(pluginInstallRoot(root), 'ntfy', 'acorn-plugin.json'))).toBe(true)

    const lock = readLockfile(root, 'ntfy')!
    expect(lock.source).toEqual({ url: 'https://example.test/acorn-plugin.tgz' })
    expect(lock.resolvedVersion).toBe('1.0.0')
    expect(lock.archiveSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    // Both entrypoints, hashed from what actually landed rather than from anything the archive claimed.
    expect(lock.entrypoints.node).toBe(createHash('sha256').update('export default { name: "ntfy", init: () => {} }\n').digest('hex'))
    expect(lock.entrypoints.client).toBe(createHash('sha256').update('export function activate() {}\n').digest('hex'))
  })

  it('unwraps the single top-level directory an npm tarball wraps everything in', async () => {
    serve(tarball(packageDir(), { nested: true }))
    await installPlugin(root, { url: 'https://example.test/acorn-plugin.tgz' })
    expect(existsSync(join(pluginInstallRoot(root), 'ntfy', 'acorn-plugin.json'))).toBe(true)
  })

  it('asks GitHub for the release, then downloads the acorn-plugin.tgz asset', async () => {
    const bytes = tarball(packageDir())
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const asked = String(input)
        calls.push(asked)
        if (asked === 'https://api.github.com/repos/acme/ntfy/releases/tags/v1.0.0') {
          return Response.json({ tag_name: 'v1.0.0', assets: [{ name: 'acorn-plugin.tgz', browser_download_url: 'https://cdn.test/a.tgz' }] })
        }
        return new Response(new Uint8Array(bytes), { status: 200 })
      }),
    )
    await installPlugin(root, { github: 'acme/ntfy', tag: 'v1.0.0' })

    expect(calls).toEqual(['https://api.github.com/repos/acme/ntfy/releases/tags/v1.0.0', 'https://cdn.test/a.tgz'])
    // The tag is provenance: the source can be re-pointed later, and this records what it meant today.
    expect(readLockfile(root, 'ntfy')!.provenance).toEqual({ tag: 'v1.0.0' })
  })

  it('refuses a release with no acorn-plugin.tgz asset, naming the convention', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tag_name: 'v1', assets: [{ name: 'source.zip', browser_download_url: 'https://cdn.test/s.zip' }] })))
    await expect(installPlugin(root, { github: 'acme/ntfy' })).rejects.toThrow(/acorn-plugin\.tgz/)
  })

  it('resolves an npm package through the registry, recording its integrity', async () => {
    const bytes = tarball(packageDir(), { nested: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) =>
        String(input) === 'https://registry.npmjs.org/acorn-ntfy'
          ? Response.json({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { dist: { tarball: 'https://registry.npmjs.org/a.tgz', integrity: 'sha512-abc' } } } })
          : new Response(new Uint8Array(bytes), { status: 200 }),
      ),
    )
    await installPlugin(root, { npm: 'acorn-ntfy' })
    expect(readLockfile(root, 'ntfy')!.provenance).toEqual({ version: '1.0.0', integrity: 'sha512-abc' })
  })
})

describe('the URL guard', () => {
  it('refuses plain http to a remote host', async () => {
    await expect(installPlugin(root, { url: 'http://example.test/p.tgz' })).rejects.toThrow(/https/)
  })

  it('allows plain http on loopback, which is how a local build server hands one over', async () => {
    serve(tarball(packageDir()), 'http://127.0.0.1:9999/p.tgz')
    await expect(installPlugin(root, { url: 'http://127.0.0.1:9999/p.tgz' })).resolves.toMatchObject({ id: 'ntfy' })
  })

  it('refuses a scheme that is neither', async () => {
    await expect(installPlugin(root, { url: 'file:///etc/passwd' })).rejects.toThrow(/https/)
  })
})

describe('validation', () => {
  const shouldRefuse = async (build: () => Buffer, pattern: RegExp) => {
    serve(build())
    await expect(installPlugin(root, { url: 'https://example.test/acorn-plugin.tgz' })).rejects.toThrow(pattern)
    // The point of every one of these: nothing was placed. A refused package leaves a node exactly as
    // it was, not with a half-written directory the loader will try at the next boot.
    expect(existsSync(join(pluginInstallRoot(root), 'ntfy'))).toBe(false)
    expect(existsSync(lockfilePath(root, 'ntfy'))).toBe(false)
  }

  it('refuses an archive with no manifest at its root', async () => {
    await shouldRefuse(() => {
      const dir = mkdtempSync(join(workshop, 'bare-'))
      writeFileSync(join(dir, 'readme.md'), 'hello')
      return tarball(dir)
    }, /acorn-plugin\.json/)
  })

  it('refuses a manifest that does not match the schema', async () => {
    await shouldRefuse(() => tarball(packageDir({ id: 'Not A Valid Id' })), /acorn-plugin\.json/)
  })

  it('refuses a package built for a different plugin API major', async () => {
    await shouldRefuse(() => tarball(packageDir({ apiVersion: '99' })), /plugin API 99/)
  })

  it('refuses a manifest naming an entrypoint the package does not contain', async () => {
    await shouldRefuse(() => tarball(packageDir({ node: './dist/missing.js' })), /does not contain/)
  })

  it('refuses a package containing a symlink that points outside itself', async () => {
    await shouldRefuse(
      () => tarball(packageDir({}, (dir) => symlinkSync('/etc/passwd', join(dir, 'secrets')))),
      /symlink pointing outside/,
    )
  })

  it("refuses a package whose id is not the one being updated", async () => {
    serve(tarball(packageDir()))
    await installPlugin(root, { url: 'https://example.test/acorn-plugin.tgz' })
    // The lockfile's source now resolves to a different plugin, the classic re-pointed-tag shape.
    serve(tarball(packageDir({ id: 'other', node: './dist/node.js' })))
    await expect(updatePlugin(root, 'ntfy')).rejects.toThrow(/is 'other', not 'ntfy'/)
  })
})

describe('updating', () => {
  const install = async (version: string) => {
    serve(tarball(packageDir({ version })))
    return await installPlugin(root, { url: 'https://example.test/acorn-plugin.tgz' })
  }

  it('re-resolves the lockfile source and reports both versions', async () => {
    await install('1.0.0')
    serve(tarball(packageDir({ version: '1.1.0' })))
    await expect(updatePlugin(root, 'ntfy')).resolves.toEqual({
      id: 'ntfy',
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      state: 'installed-restart-required',
    })
    expect(readLockfile(root, 'ntfy')!.resolvedVersion).toBe('1.1.0')
  })

  it('reports the same version twice when the source has not moved, rather than failing', async () => {
    await install('1.0.0')
    serve(tarball(packageDir({ version: '1.0.0' })))
    const result = await updatePlugin(root, 'ntfy')
    expect(result.fromVersion).toBe(result.toVersion)
  })

  it('refuses to go backwards unless the caller says so', async () => {
    await install('2.0.0')
    serve(tarball(packageDir({ version: '1.0.0' })))
    await expect(updatePlugin(root, 'ntfy')).rejects.toThrow(/older than the installed 2\.0\.0/)
    // The old version is still the installed one. A refused downgrade must not have replaced anything.
    expect(readLockfile(root, 'ntfy')!.resolvedVersion).toBe('2.0.0')

    serve(tarball(packageDir({ version: '1.0.0' })))
    await expect(updatePlugin(root, 'ntfy', { allowDowngrade: true })).resolves.toMatchObject({ toVersion: '1.0.0' })
  })

  it('refuses to update a plugin with no lockfile, because it cannot know where it came from', async () => {
    mkdirSync(join(pluginInstallRoot(root), 'handmade'), { recursive: true })
    await expect(updatePlugin(root, 'handmade')).rejects.toThrow(/does not know where/)
  })

  // "A mid-install crash cannot corrupt an existing installation" is the phase's exit criterion, and it
  // rests on two things this suite checks separately: everything up to the swap happens in staging (this
  // test), and the swap's own window is reclaimed at the next boot (the debris tests).
  it('leaves the running version untouched when the new package is refused', async () => {
    await install('1.0.0')
    const before = readFileSync(join(pluginInstallRoot(root), 'ntfy', 'acorn-plugin.json'), 'utf8')

    serve(tarball(packageDir({ version: '1.1.0', node: './dist/missing.js' })))
    await expect(updatePlugin(root, 'ntfy')).rejects.toThrow(/does not contain/)

    expect(readFileSync(join(pluginInstallRoot(root), 'ntfy', 'acorn-plugin.json'), 'utf8')).toBe(before)
    expect(readLockfile(root, 'ntfy')!.resolvedVersion).toBe('1.0.0')
    // And nothing was left behind for the loader to trip over at the next boot.
    expect(readdirSync(pluginInstallRoot(root)).filter((name) => name.startsWith('.') || name.includes('.incoming-'))).toEqual([])
  })
})

describe('uninstalling', () => {
  const installed = async () => {
    serve(tarball(packageDir()))
    await installPlugin(root, { url: 'https://example.test/acorn-plugin.tgz' })
    for (const suffix of ['', '-wal', '-shm']) writeFileSync(`${pluginDbPath(root, 'ntfy')}${suffix}`, 'x')
  }

  it('removes the package and the lockfile but keeps the database, mirroring disable', async () => {
    await installed()
    expect(uninstallPlugin(root, 'ntfy')).toEqual({ restartRequired: true, dataPurged: false })
    expect(existsSync(join(pluginInstallRoot(root), 'ntfy'))).toBe(false)
    expect(existsSync(lockfilePath(root, 'ntfy'))).toBe(false)
    expect(existsSync(pluginDbPath(root, 'ntfy'))).toBe(true)
  })

  it('deletes the database and its WAL sidecars when asked to purge', async () => {
    await installed()
    expect(uninstallPlugin(root, 'ntfy', { purgeData: true })).toEqual({ restartRequired: true, dataPurged: true })
    // All three, not just the .sqlite: a leftover -wal is a database with unmerged pages in it.
    for (const suffix of ['', '-wal', '-shm']) expect(existsSync(`${pluginDbPath(root, 'ntfy')}${suffix}`)).toBe(false)
  })

  it('refuses to uninstall something that is not installed', () => {
    expect(() => uninstallPlugin(root, 'ghost')).toThrow(/not installed/)
  })
})

describe('folder installs', () => {
  // The gate this used to assert, `allowLocalPath`, dev builds only, is gone. A folder is a
  // first-class source on every build (docs/security.md § Installing from a folder), so the absence of
  // any option at all is the assertion: nothing left for a composition root to get wrong.
  it('need no option to say which kind of build this is', async () => {
    const result = await installPlugin(root, { path: packageDir() })
    expect(result).toMatchObject({ id: 'ntfy', state: 'installed-restart-required' })
  })

  it('symlink rather than copy, so the author edits one tree', async () => {
    const dir = packageDir()
    await installPlugin(root, { path: dir })
    writeFileSync(join(dir, 'marker.txt'), 'live')
    expect(existsSync(join(pluginInstallRoot(root), 'ntfy', 'marker.txt'))).toBe(true)
  })

  // The other half of "symlinked": there is nothing to pin, and the lockfile must not claim otherwise.
  // A recorded digest would go stale on the author's next keystroke and read as provenance it is not.
  it('pin nothing, because the tree stays editable', async () => {
    await installPlugin(root, { path: packageDir() })
    expect(readLockfile(root, 'ntfy')).toMatchObject({ archiveSha256: null, entrypoints: {} })
  })

  it('unlink the symlink on uninstall rather than following it into the working tree', async () => {
    const dir = packageDir()
    await installPlugin(root, { path: dir })
    uninstallPlugin(root, 'ntfy')
    expect(existsSync(join(dir, 'acorn-plugin.json'))).toBe(true)
  })

  it('refuse a relative path', async () => {
    await expect(installPlugin(root, { path: './somewhere' })).rejects.toThrow(/absolute/)
  })
})

describe('debris', () => {
  it('reclaims a directory a crash left parked under .old-, and deletes the rest', () => {
    const plugins = pluginInstallRoot(root)
    mkdirSync(join(plugins, 'ntfy.old-0123abcd'), { recursive: true })
    writeFileSync(join(plugins, 'ntfy.old-0123abcd', 'marker'), 'x')
    mkdirSync(join(plugins, '.staging-deadbeef'), { recursive: true })
    mkdirSync(join(plugins, 'other.incoming-feedface'), { recursive: true })

    sweepDebris(root)

    // The crash window: the live directory had been renamed away and the new one never arrived. Putting
    // it back beats deleting it. The node was serving that version a moment ago.
    expect(existsSync(join(plugins, 'ntfy', 'marker'))).toBe(true)
    expect(existsSync(join(plugins, '.staging-deadbeef'))).toBe(false)
    expect(existsSync(join(plugins, 'other.incoming-feedface'))).toBe(false)
  })

  it('deletes a displaced copy whose live directory is already back', () => {
    const plugins = pluginInstallRoot(root)
    mkdirSync(join(plugins, 'ntfy'), { recursive: true })
    mkdirSync(join(plugins, 'ntfy.old-0123abcd'), { recursive: true })
    sweepDebris(root)
    expect(existsSync(join(plugins, 'ntfy.old-0123abcd'))).toBe(false)
    expect(existsSync(join(plugins, 'ntfy'))).toBe(true)
  })
})

describe('version comparison', () => {
  it('orders dotted numeric versions', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('2.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
  })

  it('refuses to order what it cannot, so the downgrade guard lets it through', () => {
    // A calendar version against a semver has no agreed ordering, and inventing one would refuse
    // upgrades for anyone whose scheme we guessed wrong.
    expect(compareVersions('2024.05', 'v1.0.0')).toBeNull()
  })

  it('ignores a prerelease suffix rather than pretending to rank it', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBe(0)
  })
})

describe('reading a lockfile', () => {
  it('is null for anything unreadable rather than throwing', () => {
    expect(readLockfile(root, 'nothing')).toBeNull()
    mkdirSync(pluginInstallRoot(root), { recursive: true })
    writeFileSync(lockfilePath(root, 'broken'), 'not json')
    expect(readLockfile(root, 'broken')).toBeNull()
    writeFileSync(lockfilePath(root, 'partial'), JSON.stringify({ installedAt: 1 } satisfies Partial<PluginLockfile>))
    expect(readLockfile(root, 'partial')).toBeNull()
  })
})
