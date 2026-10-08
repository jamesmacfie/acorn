// The instruction file check (docs/security.md § Hidden characters in instruction files). When the owner
// turns it on, this plugin's own `before-send` handler reads the files a harness takes as instructions
// and refuses the turn if one holds a hidden character. Such characters draw as nothing in an editor
// or a diff, so a line can carry instructions that nobody who reviewed it saw. The harness reads these
// files itself, with no tool call, so refusing the turn is the one place acorn can stop it.
//
// The check reads as the harness does, not as a careful reader would: it follows imports and linked
// folders, decodes damaged text rather than skipping it, and refuses the turn when it reaches one of
// its own limits. A file the check skipped is one the harness may still read.
//
// No `\u` escape appears in this file or its test. Code points are numbers, so an editing tool that
// turns escapes into the characters themselves can't plant one here.
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { deliverableSkills, type CoreServices } from '@acorn/plugin-api/node'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'

// What Claude Code and Codex read at the worktree root. Nested files that a harness reads later, when
// it works in a subfolder, are not checked unless an instruction file imports them.
const INSTRUCTION_FILES = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']
// Claude Code reads `.claude/skills`. Codex 0.159.2 reads `.agents/skills` and `.codex/skills`.
const SKILL_FOLDERS = ['.claude/skills', '.agents/skills', '.codex/skills']

// Unicode's own list of characters that draw as nothing: zero-width and joining characters, direction
// controls, the soft hyphen, fillers, variation selectors, and tag characters. A real emoji uses some
// of them, such as the variation selector in a red heart or the tags in the flag of Scotland, so whole
// emoji sequences are masked first. Anything smuggled after an emoji isn't part of the sequence, so it
// still shows.
const HIDDEN = /\p{Default_Ignorable_Code_Point}/gu
const EMOJI = /\p{RGI_Emoji}/gv
const BYTE_ORDER_MARK = 0xfeff

// Claude Code follows `@path` imports in an instruction file, up to five hops. Every candidate is
// tried, and one that names no file is skipped, so a false match costs a stat.
const IMPORT = /(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[^\s`'"()<>[\]]+)/g
const MAX_IMPORT_DEPTH = 5

// Text the harness reads however damaged it is. Any other file in a skill folder is read only when it
// is valid UTF-8, so an image isn't mistaken for text.
const TEXT_EXTENSIONS = new Set(['', '.md', '.markdown', '.mdx', '.txt'])

// Bounds that keep one pass inside the hook's 5-second timeout. Reaching one refuses the turn.
const MAX_FILES = 500
const MAX_FILE_BYTES = 1_000_000

const TURN_OFF = 'or turn off this check in Settings > Security and backup.'

export type HiddenCharacter = { file: string; line: number; codePoint: string }

/** A plugin skill a session may load, as `deliverableSkills` names it. */
export type SkillFolder = { name: string; dir: string }

/** The check reached one of its own limits. Its message is the refusal. */
export class UncheckedError extends Error {}

/** The first hidden character on each line of `text`, reported against `file`. */
export function hiddenCharactersIn(text: string, file: string): HiddenCharacter[] {
  // Same length, so an index in the masked text is the same place in the original.
  const masked = text.replace(EMOJI, (emoji) => ' '.repeat(emoji.length))
  const found: HiddenCharacter[] = []
  let line = 1
  let counted = 0
  for (const match of masked.matchAll(HIDDEN)) {
    const codePoint = match[0].codePointAt(0)!
    if (match.index === 0 && codePoint === BYTE_ORDER_MARK) continue
    for (; counted < match.index; counted++) if (masked.charCodeAt(counted) === 10) line++
    // A tag-character payload is one hidden character per letter, so report the line once.
    if (found.at(-1)?.line === line) continue
    found.push({ file, line, codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}` })
  }
  return found
}

/** The `before-send` verdict. A pass when the check is off, so the files are read only when it's on.
 *  An unexpected failure, or the hook's 5-second timeout, lets the turn through. */
export async function checkBeforeSend(
  core: Pick<CoreServices, 'identity' | 'prefs' | 'tasks'>,
  dataDir: string,
  taskId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = core.identity.active()
  if (!userId || !(await readAgentSessionDefaults(core.prefs, userId)).checkInstructionFiles) return { ok: true }
  try {
    const found = await findHiddenCharacters(await core.tasks.requireRoot(taskId), await deliverableSkills(dataDir))
    return found.length ? { ok: false, reason: hiddenCharacterReason(found) } : { ok: true }
  } catch (error) {
    if (error instanceof UncheckedError) return { ok: false, reason: error.message }
    throw error
  }
}

/** Every hidden character in the root instruction files, what they import, and the repo and plugin
 *  skill folders. Throws `UncheckedError` when a file or folder is too big to check. */
export async function findHiddenCharacters(root: string, pluginSkills: readonly SkillFolder[]): Promise<HiddenCharacter[]> {
  const label = (path: string) => (path.startsWith(root) ? relative(root, path) : path.replace(homedir(), '~'))
  const read = new Set<string>()
  const found: HiddenCharacter[] = []

  const check = async (path: string, name: string, imports: number | null): Promise<void> => {
    const real = await realpath(path).catch(() => null)
    if (!real || read.has(real)) return
    read.add(real)
    if (read.size > MAX_FILES) throw tooMany()
    const text = await readText(real, name, imports !== null || TEXT_EXTENSIONS.has(extname(path).toLowerCase()))
    if (text === null) return
    found.push(...hiddenCharactersIn(text, name))
    if (imports === null || imports >= MAX_IMPORT_DEPTH) return
    for (const target of importsIn(text, dirname(path))) await check(target, label(target), imports + 1)
  }

  for (const name of INSTRUCTION_FILES) await check(join(root, name), name, 0)
  for (const folder of SKILL_FOLDERS) {
    for (const path of await filesUnder(join(root, folder))) await check(path, label(path), null)
  }
  for (const skill of pluginSkills) {
    for (const path of await filesUnder(skill.dir)) await check(path, `${skill.name} skill, ${relative(skill.dir, path)}`, null)
  }
  return found
}

/** The refusal the person and the model read. The hook keeps 200 characters of a reason, so it names
 *  the first place and counts the rest. */
export function hiddenCharacterReason(found: readonly HiddenCharacter[]): string {
  const [first] = found
  const more = found.length > 1 ? `, and ${found.length - 1} more` : ''
  return `Hidden character ${first.codePoint} in ${first.file} line ${first.line}${more}. Remove it, ${TURN_OFF}`
}

const tooMany = () => new UncheckedError(`There are more than ${MAX_FILES} instruction and skill files to check. Remove some, ${TURN_OFF}`)

// Every `@path` an instruction file might import, as absolute paths. Trailing punctuation is tried
// both ways, because a sentence can end on an import.
function importsIn(text: string, from: string): string[] {
  const targets = new Set<string>()
  for (const [, written] of text.matchAll(IMPORT)) {
    for (const path of new Set([written, written.replace(/[.,;:!?]+$/, '')])) {
      targets.add(path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(from, path))
    }
  }
  return [...targets]
}

// Files, depth first, through linked folders as the harness goes. A folder is entered once by its real
// path, so a link back up the tree ends rather than loops, and a link out to a large tree reaches
// the file limit and refuses the turn.
async function filesUnder(dir: string, out: string[] = [], entered = new Set<string>()): Promise<string[]> {
  const real = await realpath(dir).catch(() => null)
  if (!real || entered.has(real)) return out
  entered.add(real)
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name)
    const kind = entry.isSymbolicLink() ? await stat(path).catch(() => null) : entry
    if (kind?.isDirectory()) await filesUnder(path, out, entered)
    else if (kind?.isFile()) out.push(path)
    if (out.length > MAX_FILES) throw tooMany()
  }
  return out
}

// Null for a missing or unreadable file, which the harness can't read either, and for a file that
// isn't text. Throws for one over the size limit rather than skipping it.
async function readText(path: string, name: string, text: boolean): Promise<string | null> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile()) return null
  if (info.size > MAX_FILE_BYTES) throw new UncheckedError(`The check can't read ${name}, which is over 1 MB. Shrink it, ${TURN_OFF}`)
  const bytes = await readFile(path).catch(() => null)
  return bytes ? decode(bytes, text) : null
}

// A byte order mark picks UTF-16. Otherwise UTF-8: strict for a file that may be binary, and with
// replacement characters for text, because a harness reads past a bad byte rather than stopping.
function decode(bytes: Buffer, text: boolean): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return text ? new TextDecoder('utf-8').decode(bytes) : null
  }
}
