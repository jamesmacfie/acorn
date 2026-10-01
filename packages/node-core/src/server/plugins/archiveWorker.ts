// Trusted, archive-only entry: node-tar owns both effective header parsing and extraction.
// Preflight and extraction use the same immutable staged bytes and parser release.
import { createReadStream, mkdirSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { Parser, x, ReadEntry } from 'tar'
import type { PLUGIN_ARCHIVE_LIMITS } from './archive'
import { archiveExpandedMeter } from './archiveMeter.ts'

const { archive, into, limits } = JSON.parse(await new Promise<string>((resolve, reject) => {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => { input += chunk; if (input.length > 16 * 1024) reject(new Error('Oversized archive process input.')) })
  process.stdin.once('error', reject)
  process.stdin.once('end', () => resolve(input))
})) as { archive: string; into: string; limits: typeof PLUGIN_ARCHIVE_LIMITS }
const refuse = (reason: string): never => { throw new Error(`That plugin archive was refused: ${reason}`) }
let members = 0
let logicalBytes = 0
const links = new Set<string>()
const count = () => { if (++members > limits.members) refuse('too many members or metadata records.') }
const checkedPath = (path: string, link = false): string => {
  if (typeof path !== 'string' || Buffer.byteLength(path) > limits.pathBytes || path.includes('\0') || path.includes('\\') || posix.isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path)) {
    refuse(link ? 'a symlink pointing outside or containing an invalid path.' : 'an invalid or oversized path.')
  }
  const parts = path.split('/').filter((part) => part && part !== '.')
  if ((!link && parts.includes('..')) || parts.length > limits.depth) refuse('a traversal or excessively deep path.')
  return posix.normalize(path)
}
const filter = (_path: string, entry: ReadEntry | import('node:fs').Stats): boolean => {
  if (!(entry instanceof ReadEntry)) return refuse('an invalid archive member.')
  count()
  const memberPath = checkedPath(entry.path)
  const components = memberPath.split('/')
  for (let depth = 1; depth < components.length; depth++) {
    if (links.has(components.slice(0, depth).join('/'))) refuse('a member descends through an archive link.')
  }
  if (links.has(memberPath)) refuse('a member replaces an archive link.')
  if (!['File', 'OldFile', 'Directory', 'SymbolicLink', 'Link'].includes(entry.type)) refuse(`unsupported member type '${entry.type}'.`)
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > limits.fileBytes) refuse('a member exceeds the file size limit.')
  if (entry.type === 'File' || entry.type === 'OldFile') {
    logicalBytes += entry.size
    if (logicalBytes > limits.logicalBytes) refuse('files exceed the total logical size limit.')
  } else if (entry.size !== 0) refuse('a non-file member contains data.')
  if (entry.linkpath) {
    const target = checkedPath(entry.linkpath, entry.type === 'SymbolicLink')
    const resolved = entry.type === 'SymbolicLink' ? posix.join(posix.dirname(entry.path), target) : target
    if (resolved === '..' || resolved.startsWith('../')) refuse('a symlink pointing outside the extraction directory.')
    links.add(memberPath)
  }
  return true
}

async function unpack(): Promise<void> {
  const parser = new Parser({ strict: true, brotli: false, zstd: false, maxMetaEntrySize: limits.metadataBytes, filter, onReadEntry: (entry) => entry.resume() })
  let parserError: Error | undefined
  parser.on('error', (error) => { parserError = error })
  parser.on('ignoredEntry', () => refuse('an unsupported member or oversized metadata record.'))
  parser.on('meta', (metadata: string) => {
    count()
    // node-tar intentionally discards unknown PAX fields. Sparse semantics must never silently
    // degrade into ordinary files, so refuse sparse declarations before the following member.
    if (/(?:^|\n)\d+ (?:GNU\.sparse[^=]*|SCHILY\.realsize|SCHILY\.filetype|SUN\.holesdata)=/.test(metadata)) refuse('sparse metadata is unsupported.')
  })
  const meter = archiveExpandedMeter(limits.expandedBytes)
  // An ordinary Writable catches synchronous parser/filter refusals in its callback. Directly
  // piping to the EventEmitter parser would let a thrown filter escape the pipeline promise.
  const sink = new Writable({ write(chunk: Buffer, _encoding, done) {
    try {
      parser.write(chunk)
      done(parserError)
    } catch (error) { done(error instanceof Error ? error : new Error(String(error))) }
  }, final(done) {
    try {
      parser.end()
      done(parserError)
    } catch (error) { done(error instanceof Error ? error : new Error(String(error))) }
  } })
  await pipeline(createReadStream(archive), createGunzip(), meter, sink)
  if (parserError) throw parserError
  mkdirSync(into, { recursive: true, mode: 0o700 })
  await x({ file: archive, cwd: into, strict: true, maxMetaEntrySize: limits.metadataBytes, maxDepth: limits.depth, preserveOwner: false, noMtime: true,
    // Keep owner executable bits for harnesses; archive permissions never open access to other users.
    chmod: true, filter: (_path, entry) => { if (!(entry instanceof ReadEntry)) return false; entry.mode = entry.type === 'Directory' ? 0o700 : ((entry.mode ?? 0o600) & 0o700) | 0o600; return true },
  })
}

try {
  await unpack()
  process.stdout.write(JSON.stringify({ ok: true }))
} catch (error) {
  const message = error instanceof Error ? error.message : 'The plugin archive could not be unpacked.'
  process.stdout.write(JSON.stringify({ ok: false, error: message.replace(/\p{Cc}/gu, ' ').slice(0, 1024) }))
  process.exitCode = 1
}
