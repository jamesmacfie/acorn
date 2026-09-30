import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { archiveExpandedMeter } from './archiveMeter'
import { Header, Pax } from 'tar'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { PLUGIN_ARCHIVE_LIMITS, unpackPluginArchive } from './archive'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'acorn-archive-policy-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

// Maintained writer constructs small tar headers; no advisory payloads or large input fixtures.
function member(path: string, body = Buffer.alloc(0), type: 'File' | 'Directory' | 'SymbolicLink' | 'Link' | 'FIFO' | 'BlockDevice' | 'SparseFile' | 'ExtendedHeader' | 'NextFileHasLongPath' = 'File', linkpath?: string): Buffer {
  const header = new Header({ path, size: body.length, type, linkpath, mode: 0o755 })
  const bytes = Buffer.alloc(512)
  header.encode(bytes)
  return Buffer.concat([bytes, body, Buffer.alloc((512 - body.length % 512) % 512)])
}
function archive(parts: Buffer[]): string {
  const path = join(root, 'package.tgz')
  writeFileSync(path, gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)])))
  return path
}
async function refused(parts: Buffer[], limits: Partial<typeof PLUGIN_ARCHIVE_LIMITS>, pattern: RegExp): Promise<void> {
  const out = join(root, 'out')
  await expect(unpackPluginArchive(archive(parts), out, { ...PLUGIN_ARCHIVE_LIMITS, ...limits })).rejects.toThrow(pattern)
  expect(existsSync(out)).toBe(false)
}

it('extracts ordinary PAX/GNU paths and confined symbolic and hard aliases', async () => {
  const pax = new Pax({ path: 'package/pax.js' }).encode()
  const input = archive([
    member('package', undefined, 'Directory'),
    member('package/file.js', Buffer.from('content')),
    member('package/alias.js', undefined, 'SymbolicLink', 'file.js'),
    member('package/hard.js', undefined, 'Link', 'package/file.js'),
    pax, member('short.js', Buffer.from('pax')),
    member('././@LongLink', Buffer.from('package/gnu.js\0'), 'NextFileHasLongPath'), member('short.js', Buffer.from('gnu')),
  ])
  const out = join(root, 'out')
  await unpackPluginArchive(input, out)
  for (const name of ['file.js', 'alias.js', 'hard.js']) expect(readFileSync(join(out, 'package', name), 'utf8')).toBe('content')
  expect(readFileSync(join(out, 'package/pax.js'), 'utf8')).toBe('pax')
  expect(readFileSync(join(out, 'package/gnu.js'), 'utf8')).toBe('gnu')
})

it('bounds decompressed bytes before writing', async () => {
  await refused([member('small', Buffer.from('tiny'))], { expandedBytes: 512 }, /expanded byte/)
})
it('rejects nested compression that would bypass the outer expanded meter', async () => {
  const input = archive([member('small')])
  writeFileSync(input, gzipSync(readFileSync(input)))
  await expect(unpackPluginArchive(input, join(root, 'out'))).rejects.toThrow(/Nested compression/)
  expect(existsSync(join(root, 'out'))).toBe(false)
})
it('holds a split compression prefix before releasing parser bytes', async () => {
  const released: Buffer[] = []
  const sink = new Writable({ write(chunk, _encoding, done) { released.push(Buffer.from(chunk)); done() } })
  await expect(pipeline(Readable.from([Buffer.from([0x1f]), Buffer.from([0x8b])]), archiveExpandedMeter(8), sink)).rejects.toThrow(/Nested compression/)
  expect(released).toEqual([])
})
it('checks effective PAX sizes and total logical bytes', async () => {
  await refused([new Pax({ size: 9 }).encode(), member('pax', Buffer.alloc(9))], { fileBytes: 8 }, /file size/)
  await refused([member('one', Buffer.alloc(5)), member('two', Buffer.alloc(5))], { logicalBytes: 8 }, /total logical/)
})
it('counts repeated entries and limits effective path depth and bytes', async () => {
  await refused([member('same'), member('same')], { members: 1 }, /too many/)
  await refused([new Pax({ path: 'a/b/c' }).encode(), member('short')], { depth: 2 }, /deep/)
  await refused([member('abcdef')], { pathBytes: 5 }, /oversized path/)
})
it('refuses oversized metadata and unsupported sparse and special members', async () => {
  await refused([member('meta', Buffer.from('comment'), 'ExtendedHeader'), member('file')], { metadataBytes: 4 }, /metadata/)
  for (const type of ['FIFO', 'BlockDevice', 'SparseFile'] as const) await refused([member('special', undefined, type)], {}, /unsupported/)
  // Compute the record length rather than relying on a hand-counted fixture.
  for (const key of ['GNU.sparse.realsize', 'SCHILY.realsize', 'SUN.holesdata']) {
    const field = ` ${key}=99\n`
    const length = Buffer.byteLength(field) + 2
    await refused([member('pax', Buffer.from(`${length}${field}`), 'ExtendedHeader'), member('file')], {}, /sparse/)
  }
})
it('rejects traversal, external links, and members descending through internal aliases', async () => {
  await refused([member('../outside')], {}, /traversal/)
  await refused([member('alias', undefined, 'SymbolicLink', '../outside')], {}, /outside/)
  await refused([member('dir', undefined, 'Directory'), member('alias', undefined, 'SymbolicLink', 'dir'), member('alias/child')], {}, /descends through/)
})
it('fails malformed/truncated input and waits for deadline termination before cleanup', async () => {
  const input = archive([member('file', Buffer.from('tiny'))])
  writeFileSync(input, Buffer.from('not gzip'))
  await expect(unpackPluginArchive(input, join(root, 'out'))).rejects.toThrow()
  const valid = archive([member('file')])
  await expect(unpackPluginArchive(valid, join(root, 'out'), { ...PLUGIN_ARCHIVE_LIMITS, timeoutMs: 1 })).rejects.toThrow(/deadline/)
  rmSync(join(root, 'out'), { recursive: true, force: true })
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(existsSync(join(root, 'out'))).toBe(false)
})
