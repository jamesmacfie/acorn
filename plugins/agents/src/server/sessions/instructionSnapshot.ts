// Bounded, read-only discovery of the repository instructions a managed harness may load.
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
type SkillFolder = { name: string; dir: string }

export const INSTRUCTION_ANALYZER_VERSION = 2
const NAMES = new Set(['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'CLAUDE.local.md'])
const SKILLS = ['.claude/skills', '.agents/skills', '.codex/skills']
const EXCLUDED = new Set([
  '.git',
  '.acorn',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  'node_modules',
  'vendor',
  '.pnpm',
  '.next',
  'dist',
  'build',
  'target',
  'coverage',
])
const IMPORT = /(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[^\s`'"()<>[\]]+)/g
const TEXT = new Set([
  '',
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.sh',
  '.bash',
  '.zsh',
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
])
const MAX_FILES = 500
const MAX_DIRECTORIES = 5_000
const MAX_DEPTH = 20
const MAX_BYTES = 8 * 1024 * 1024
const MAX_FILE_BYTES = 1_000_000
const READ_CHUNK_BYTES = 64 * 1024
const MAX_MS = 5_000
export const INSTRUCTION_SCOPE = `root and nested AGENTS.md, AGENTS.override.md, CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md; Claude @imports (five hops); repository ${SKILLS.join(', ')} and delivered plugin skills with supporting files; excludes ${[...EXCLUDED].join(', ')} and ordinary repository symlink directories; scan limits ${MAX_FILES} files, ${MAX_DIRECTORIES} directories, ${MAX_DEPTH} levels, ${MAX_BYTES} bytes, ${MAX_FILE_BYTES} bytes per file, ${MAX_MS} ms; advisory analysis inspects the first 20,000 lines per file and reports at most 2,000 findings`

export type InstructionFile = {
  path: string
  canonicalPath: string
  sha256: string
  bytes: number
  text: string | null
  kind: 'instruction' | 'skill' | 'import'
  unsupported: boolean
}
export type InstructionSnapshot = { files: InstructionFile[]; scope: string; version: number }
export class InstructionScanIncomplete extends Error {}

function decode(bytes: Buffer, required: boolean): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return required ? new TextDecoder('utf-8').decode(bytes) : null
  }
}

/** No background timeout promise: every read gets the same abort signal and work stops on expiry. */
export async function scanInstructions(
  root: string,
  pluginSkills: readonly SkillFolder[],
  signal?: AbortSignal,
): Promise<InstructionSnapshot> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('Instruction scan timed out.')), MAX_MS)
  const files = new Map<string, InstructionFile>()
  // Preserve each discovered alias in the approval digest, but read one canonical file once.
  const canonicalBytes = new Map<string, Buffer>()
  const directories = new Set<string>()
  let totalBytes = 0
  const check = () => {
    if (controller.signal.aborted)
      throw new InstructionScanIncomplete(
        'Instruction scan did not finish. Retry the review or change the setting in Settings > Security and backup.',
      )
  }
  const canonical = async (path: string, optional: boolean): Promise<string | null> => {
    check()
    let resolved: string
    try {
      resolved = await realpath(path)
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          await lstat(path)
        } catch (missing) {
          if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return null
        }
      }
      throw new InstructionScanIncomplete(
        `Cannot inspect ${path}. Check its permissions or links, then retry the review.`,
      )
    }
    check()
    return resolved
  }
  const label = (path: string) => (path.startsWith(root + '/') ? relative(root, path) : path.replace(homedir(), '~'))
  const readBounded = async (path: string, real: string): Promise<Buffer> => {
    const limit = Math.min(MAX_FILE_BYTES, MAX_BYTES - totalBytes)
    let handle
    try {
      handle = await open(real, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
    } catch {
      check()
      throw new InstructionScanIncomplete(`Cannot open ${label(path)}. Check its permissions or link and retry.`)
    }
    try {
      check()
      const info = await handle.stat()
      check()
      if (!info.isFile())
        throw new InstructionScanIncomplete(`${label(path)} is not a regular file. Remove the special input and retry.`)
      if (info.size > limit)
        throw new InstructionScanIncomplete(
          `Instruction scan exceeded its byte limit at ${label(path)}. Reduce the input and retry.`,
        )
      // One extra byte detects growth after fstat. Retain only bytes actually read, so hundreds
      // of small files do not each keep a full-size scratch buffer in the canonical cache.
      const scratch = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit + 1))
      const chunks: Buffer[] = []
      let length = 0
      while (length <= limit) {
        check()
        const count = Math.min(READ_CHUNK_BYTES, limit + 1 - length)
        const result = await handle.read(scratch, 0, count, length)
        check()
        if (result.bytesRead === 0) break
        chunks.push(Buffer.from(scratch.subarray(0, result.bytesRead)))
        length += result.bytesRead
      }
      if (length > limit)
        throw new InstructionScanIncomplete(
          `Instruction scan exceeded its byte limit at ${label(path)}. Reduce the input and retry.`,
        )
      return Buffer.concat(chunks, length)
    } catch (error) {
      if (error instanceof InstructionScanIncomplete) throw error
      check()
      throw new InstructionScanIncomplete(`Cannot read ${label(path)}. Check its permissions and retry.`)
    } finally {
      await handle.close()
    }
  }
  const file = async (
    path: string,
    kind: InstructionFile['kind'],
    optional = false,
    depth = 0,
    chain = new Set<string>(),
  ): Promise<void> => {
    check()
    const real = await canonical(path, optional)
    if (!real) return
    if (chain.has(real))
      throw new InstructionScanIncomplete(`Instruction import cycle at ${label(path)}. Remove the cycle and retry.`)
    if (files.has(path)) return
    if (files.size >= MAX_FILES)
      throw new InstructionScanIncomplete(
        'Instruction scan exceeded 500 files. Reduce the discovered inputs and retry.',
      )
    let bytes = canonicalBytes.get(real)
    if (!bytes) {
      bytes = await readBounded(path, real)
      canonicalBytes.set(real, bytes)
    }
    check()
    if ((await canonical(path, false)) !== real) {
      throw new InstructionScanIncomplete(`${label(path)} changed its link target during the scan. Retry the review.`)
    }
    totalBytes += bytes.byteLength
    if (bytes.byteLength > MAX_FILE_BYTES || totalBytes > MAX_BYTES)
      throw new InstructionScanIncomplete(
        `Instruction scan exceeded its byte limit at ${label(path)}. Reduce the input and retry.`,
      )
    const supported = kind !== 'skill' || TEXT.has(extname(path).toLowerCase())
    const text = supported ? decode(bytes, true) : null
    files.set(path, {
      path: label(path),
      canonicalPath: real,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      text,
      kind,
      unsupported: text === null,
    })
    if (kind === 'skill' || text === null) return
    if (depth >= 5) return
    const nextChain = new Set(chain).add(real)
    for (const [, written] of text.matchAll(IMPORT)) {
      for (const candidate of new Set([written, written.replace(/[.,;:!?]+$/, '')])) {
        const target = candidate.startsWith('~/')
          ? join(homedir(), candidate.slice(2))
          : resolve(dirname(path), candidate)
        await file(target, 'import', true, depth + 1, nextChain)
      }
    }
  }
  const walk = async (
    dir: string,
    depth: number,
    kind: 'repository' | 'skill',
    optional: boolean,
    chain = new Set<string>(),
  ): Promise<void> => {
    check()
    if (depth > MAX_DEPTH)
      throw new InstructionScanIncomplete(`Instruction scan exceeded directory depth at ${label(dir)}.`)
    const real = await canonical(dir, optional)
    if (!real) return
    if (chain.has(real))
      throw new InstructionScanIncomplete(`Instruction directory cycle at ${label(dir)}. Remove the link and retry.`)
    if (directories.has(real)) return
    directories.add(real)
    if (directories.size > MAX_DIRECTORIES)
      throw new InstructionScanIncomplete('Instruction scan exceeded 5,000 directories.')
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      throw new InstructionScanIncomplete(`Cannot list ${label(dir)}. Check its permissions and retry.`)
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const nextChain = new Set(chain).add(real)
    for (const entry of entries) {
      check()
      if (EXCLUDED.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (kind === 'repository' && SKILLS.includes(relative(root, path))) continue
      if (kind === 'repository' && entry.isSymbolicLink() && !NAMES.has(entry.name)) continue
      let info
      try {
        info = entry.isSymbolicLink() ? await stat(path) : await lstat(path)
      } catch {
        throw new InstructionScanIncomplete(`Cannot inspect ${label(path)}. Check its link and retry.`)
      }
      if (info.isDirectory()) {
        if (kind === 'repository' && NAMES.has(entry.name)) {
          throw new InstructionScanIncomplete(
            `${label(path)} is a directory, not an instruction file. Remove it and retry.`,
          )
        }
        // Repository symlink directories do not become a second repository. Explicit skill roots
        // and linked skill contents are followed because the harness can offer those folders.
        if (kind === 'repository' && entry.isSymbolicLink()) continue
        await walk(path, depth + 1, kind, false, nextChain)
      } else if (info.isFile()) {
        if (kind === 'skill') await file(path, 'skill')
        else if (NAMES.has(entry.name) || (entry.name === 'CLAUDE.md' && dir.endsWith('/.claude')))
          await file(path, 'instruction')
      } else if (kind === 'skill' || NAMES.has(entry.name)) {
        throw new InstructionScanIncomplete(`${label(path)} is a special input. Remove it and retry.`)
      }
    }
  }
  try {
    check()
    await walk(root, 0, 'repository', false)
    for (const folder of SKILLS) await walk(join(root, folder), 0, 'skill', true)
    for (const skill of pluginSkills) await walk(skill.dir, 0, 'skill', true)
    check()
    return {
      files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
      scope: INSTRUCTION_SCOPE,
      version: INSTRUCTION_ANALYZER_VERSION,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
