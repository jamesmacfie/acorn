// The instruction file check (docs/security.md § Hidden characters in instruction files). When the owner
// turns it on, this plugin's own `before-send` handler reads the files a harness takes as instructions
// and refuses the turn if one holds a hidden character. Zero-width, text-direction, and Unicode tag
// characters draw as nothing in an editor or a diff, so a line can carry instructions that nobody who
// reviewed it saw. The harness reads these files itself, with no tool call, so refusing the turn is
// the one place acorn can stop it.
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { deliverableSkills, type CoreServices } from '@acorn/plugin-api/node'
import { readAgentSessionDefaults } from '../sessionDefaultsStore'

// What Claude Code and Codex read at the worktree root. Nested files that a harness reads later, when
// it works in a subfolder, are not checked.
const INSTRUCTION_FILES = ['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md']
// Claude Code reads `.claude/skills`. Codex 0.159.2 reads `.agents/skills` and `.codex/skills`.
const SKILL_FOLDERS = ['.claude/skills', '.agents/skills', '.codex/skills']

// Zero-width spaces and joiners, direction marks and overrides, invisible operators, the byte order
// mark anywhere but the start of a file, and tag characters.
const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu

// One pass stays well inside the hook's 5-second timeout. A timeout lets the turn through unchecked,
// so a folder too big to read in time must be cut short rather than left to run out the clock.
const MAX_FILES = 500
const MAX_FILE_BYTES = 1_000_000

export type HiddenCharacter = { file: string; line: number; codePoint: string }

/** A plugin skill a session may load, as `deliverableSkills` names it. */
export type SkillFolder = { name: string; dir: string }

/** The first hidden character on each line of `text`, reported against `file`. */
export function hiddenCharactersIn(text: string, file: string): HiddenCharacter[] {
  const found: HiddenCharacter[] = []
  let line = 1
  let counted = 0
  for (const match of text.matchAll(HIDDEN)) {
    if (match.index === 0 && match[0] === '\uFEFF') continue
    for (; counted < match.index; counted++) if (text.charCodeAt(counted) === 10) line++
    // A tag-character payload is one hidden character per letter, so report the line once.
    if (found.at(-1)?.line === line) continue
    found.push({ file, line, codePoint: `U+${match[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}` })
  }
  return found
}

/** The `before-send` verdict. A pass when the check is off, so the files are read only when it's on.
 *  A failure here, or the hook's 5-second timeout, lets the turn through, which is why the scan is
 *  bounded to finish well inside it. */
export async function checkBeforeSend(
  core: Pick<CoreServices, 'identity' | 'prefs' | 'tasks'>,
  dataDir: string,
  taskId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = core.identity.active()
  if (!userId || !(await readAgentSessionDefaults(core.prefs, userId)).checkInstructionFiles) return { ok: true }
  const found = await findHiddenCharacters(await core.tasks.requireRoot(taskId), await deliverableSkills(dataDir))
  return found.length ? { ok: false, reason: hiddenCharacterReason(found) } : { ok: true }
}

/** Every hidden character in the root instruction files and the repo and plugin skill folders. */
export async function findHiddenCharacters(root: string, pluginSkills: readonly SkillFolder[]): Promise<HiddenCharacter[]> {
  const files: Array<{ path: string; label: string }> = INSTRUCTION_FILES.map((name) => ({ path: join(root, name), label: name }))
  for (const folder of SKILL_FOLDERS) {
    for (const path of await filesUnder(join(root, folder))) files.push({ path, label: relative(root, path) })
  }
  for (const skill of pluginSkills) {
    for (const path of await filesUnder(skill.dir)) files.push({ path, label: `${skill.name} skill, ${relative(skill.dir, path)}` })
  }
  const found: HiddenCharacter[] = []
  for (const file of files.slice(0, MAX_FILES)) {
    const text = await readText(file.path)
    if (text) found.push(...hiddenCharactersIn(text, file.label))
  }
  return found
}

/** The refusal the person and the model read. The hook keeps 200 characters of a reason, so it names
 *  the first place and counts the rest. */
export function hiddenCharacterReason(found: readonly HiddenCharacter[]): string {
  const [first] = found
  const more = found.length > 1 ? `, and ${found.length - 1} more` : ''
  return `Hidden character ${first.codePoint} in ${first.file} line ${first.line}${more}. Remove it, or turn off this check in Settings > Security and backup.`
}

// Files only, depth first. A linked folder is not entered, so a link can't walk the check out of the
// skill folder or round in a loop. A linked file is read, because the harness reads it too.
async function filesUnder(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (out.length >= MAX_FILES) break
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await filesUnder(path, out)
    else if (entry.isFile() || (entry.isSymbolicLink() && (await stat(path).catch(() => null))?.isFile())) out.push(path)
  }
  return out
}

// Null for a missing file, one over the size cap, or a binary one, judged by a NUL in its first 8 KB.
async function readText(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return null
  const bytes = await readFile(path).catch(() => null)
  if (!bytes || bytes.subarray(0, 8192).includes(0)) return null
  return bytes.toString('utf8')
}
