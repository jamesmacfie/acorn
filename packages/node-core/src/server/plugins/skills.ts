// Reads and checks one skill a package declares: a folder with a `SKILL.md` in it
// (docs/managed-agents/skills.md § Skills). The installer, the loader and every session start call it, so
// a package edited after it was approved is caught before an agent is pointed at it.
//
// The frontmatter rules are Anthropic's published ones for `SKILL.md`: `name` is up to 64 lower-case
// letters, digits and dashes, and `description` is up to 1,024 characters with no XML tags. Other keys
// are allowed and ignored, so a skill written for Claude Code drops in unchanged.
import { createHash } from 'node:crypto'
import { lstatSync, opendirSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { PluginSkillDescriptor } from '@acorn/protocol/plugin/contract.ts'
import { resolveInRoot } from '../core/fs'

export const SKILL_LIMITS = {
  nameChars: 64,
  descriptionChars: 1_024,
  bodyBytes: 64 * 1024,
  // The whole folder is hashed on every session start, so it stays small. Supporting files are meant
  // to be a few references and scripts, not a dataset.
  folderBytes: 1024 * 1024,
  folderEntries: 64,
  folderDepth: 4,
} as const

export type PackageSkill = {
  /** The id the manifest declared, unqualified. */
  id: string
  /** The real path of the skill's folder, which is what an agent is told and granted. */
  dir: string
  /** `<dir>/SKILL.md`. */
  file: string
  name: string
  description: string
  /** sha256 over every file in the folder, by relative path. What the owner approves. */
  digest: string
}

export type SkillRead = { ok: true; skill: PackageSkill } | { ok: false; reason: string }

const NAME_RE = /^[a-z0-9-]+$/
const XML_TAG_RE = /<\/?[A-Za-z][^>]*>/
// C0 controls but tab and newline, DEL, C1 controls, line and paragraph separators, and the
// bidirectional overrides that can make a description read differently from what it says.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** Hash the folder, refusing anything an agent could follow out of it. */
export function skillFolderDigest(dir: string): { ok: true; digest: string } | { ok: false; reason: string } {
  const files: string[] = []
  let entries = 0
  let bytes = 0
  const walk = (at: string, depth: number): string | null => {
    if (depth > SKILL_LIMITS.folderDepth) return `has more than ${SKILL_LIMITS.folderDepth} folder levels`
    const directory = opendirSync(at)
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++entries > SKILL_LIMITS.folderEntries) return `holds more than ${SKILL_LIMITS.folderEntries} entries`
        const full = join(at, entry.name)
        // No links at all, so every file an agent is pointed at is the file that was hashed.
        if (entry.isSymbolicLink()) return `contains a symlink (${relative(dir, full)})`
        if (entry.isDirectory()) {
          const problem = walk(full, depth + 1)
          if (problem) return problem
        } else if (entry.isFile()) {
          bytes += lstatSync(full).size
          if (bytes > SKILL_LIMITS.folderBytes) return 'is larger than 1 MiB'
          files.push(full)
        } else {
          return `contains an unsupported entry (${relative(dir, full)})`
        }
      }
    } finally {
      directory.closeSync()
    }
    return null
  }
  try {
    const problem = walk(dir, 0)
    if (problem) return { ok: false, reason: `its folder ${problem}` }
    const hash = createHash('sha256')
    for (const file of files.map((full) => relative(dir, full).split('\\').join('/')).sort()) {
      const content = readFileSync(join(dir, file))
      hash.update(`${file}\0${content.byteLength}\0`).update(content)
    }
    return { ok: true, digest: hash.digest('hex') }
  } catch (error) {
    return { ok: false, reason: `its folder can't be read (${(error as NodeJS.ErrnoException).code ?? 'error'})` }
  }
}

/** Read one declared skill out of an installed package. Every failure names what broke. */
export function readPackageSkill(packageDir: string, descriptor: PluginSkillDescriptor): SkillRead {
  const fail = (reason: string): SkillRead => ({ ok: false, reason: `skill '${descriptor.id}': ${reason}` })
  const declared = resolveInRoot(packageDir, descriptor.path)
  if (!declared) return fail(`path '${descriptor.path}' resolves outside the package`)
  let dir: string
  try {
    if (lstatSync(declared).isSymbolicLink() || !lstatSync(declared).isDirectory()) return fail(`path '${descriptor.path}' is not a folder`)
    dir = realpathSync(declared)
  } catch {
    return fail(`path '${descriptor.path}' is missing`)
  }
  const folder = skillFolderDigest(dir)
  if (!folder.ok) return fail(folder.reason)
  const file = join(dir, 'SKILL.md')
  let text: string
  try {
    if (!lstatSync(file).isFile()) return fail('SKILL.md is not a file')
    text = utf8.decode(readFileSync(file))
  } catch (error) {
    return fail(error instanceof TypeError ? 'SKILL.md is not UTF-8' : 'its folder has no SKILL.md')
  }
  const parsed = parseSkillFile(text)
  if (!parsed.ok) return fail(parsed.reason)
  return { ok: true, skill: { id: descriptor.id, dir, file, name: parsed.name, description: parsed.description, digest: folder.digest } }
}

/** The frontmatter's `name` and `description`, checked, and the body's size. */
export function parseSkillFile(text: string): { ok: true; name: string; description: string } | { ok: false; reason: string } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { ok: false, reason: 'SKILL.md must start with YAML frontmatter between --- lines' }
  const end = lines.indexOf('---', 1)
  if (end < 0) return { ok: false, reason: 'SKILL.md frontmatter has no closing --- line' }
  const body = lines.slice(end + 1).join('\n')
  if (Buffer.byteLength(body, 'utf8') > SKILL_LIMITS.bodyBytes) return { ok: false, reason: 'SKILL.md body is larger than 64 KiB' }
  if (body.includes('\u0000')) return { ok: false, reason: 'SKILL.md body contains a NUL character' }
  const fields = frontmatterStrings(lines.slice(1, end))
  if (typeof fields === 'string') return { ok: false, reason: fields }
  const name = fields.name
  const description = fields.description?.trim()
  if (!name) return { ok: false, reason: 'frontmatter has no name' }
  if (name.length > SKILL_LIMITS.nameChars || !NAME_RE.test(name)) {
    return { ok: false, reason: 'frontmatter name must be up to 64 lower-case letters, digits and dashes' }
  }
  if (!description) return { ok: false, reason: 'frontmatter has no description' }
  if ([...description].length > SKILL_LIMITS.descriptionChars) return { ok: false, reason: 'frontmatter description is longer than 1,024 characters' }
  if (XML_TAG_RE.test(description)) return { ok: false, reason: 'frontmatter description contains an XML tag' }
  if (CONTROL_RE.test(description)) return { ok: false, reason: 'frontmatter description contains a control character' }
  return { ok: true, name, description }
}

// The two string fields this host reads, in the YAML forms skills are written in: plain, quoted, and
// `|` or `>` blocks. It is not a YAML parser. Other keys are skipped whatever their shape, and a
// name or description in a form this doesn't read is refused rather than guessed at.
function frontmatterStrings(lines: string[]): Record<string, string> | string {
  const out: Record<string, string> = {}
  for (let at = 0; at < lines.length; at++) {
    const match = /^([A-Za-z0-9_-]+):(.*)$/.exec(lines[at]!)
    if (!match) continue
    const key = match[1]!
    if (key !== 'name' && key !== 'description') continue
    const value = match[2]!.trim()
    const continued: string[] = []
    while (at + 1 < lines.length && (/^\s/.test(lines[at + 1]!) || lines[at + 1] === '')) continued.push(lines[++at]!.trim())
    while (continued.length && continued[continued.length - 1] === '') continued.pop()
    if (/^[|>][+-]?$/.test(value)) {
      out[key] = value.startsWith('|') ? continued.join('\n') : continued.join(' ').replace(/ {2,}/g, '\n')
    } else if (value.startsWith('"')) {
      try {
        const parsed: unknown = JSON.parse([value, ...continued].join(' '))
        if (typeof parsed !== 'string') return `frontmatter ${key} isn't a string`
        out[key] = parsed
      } catch {
        return `frontmatter ${key} isn't a quoted string this host can read`
      }
    } else if (value.startsWith("'")) {
      const joined = [value, ...continued].join(' ')
      if (!joined.endsWith("'") || joined.length < 2) return `frontmatter ${key} isn't a quoted string this host can read`
      out[key] = joined.slice(1, -1).replaceAll("''", "'")
    } else {
      out[key] = [value, ...continued].join(' ').replace(/\s+#.*$/, '')
    }
  }
  return out
}
