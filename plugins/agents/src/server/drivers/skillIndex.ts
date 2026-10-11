// The skills a provider receives at every start and resume (docs/managed-agents/skills.md § Delivery).
//
// A harness with its own skill support gets a copy of every skill in a folder it loads natively
// (`writeSkillFolder`). Everything else goes in the index: names, descriptions and the absolute path of
// each `SKILL.md`, under one fixed sentence from acorn. The agent reads a body only when a task matches,
// so ten skills cost ten lines.
//
// A skill leaves the index only once the harness has advertised it under its native name, so a native
// load that failed or hasn't been reported yet still reaches the agent through the index. The lifecycle
// sends the index as a context part ahead of the first turn after a start, on every harness. Not in a
// system prompt: Claude Code keeps the one a session was created with, so a resumed session would keep a
// skill the owner switched off. The report goes back only once the turn that carried it has run.
import type { DeliverableSkill } from '@acorn/plugin-api/node'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import { nativeSkillName, removeSkillFolder, writeSkillFolder } from './skillFolder'

/** The index part of one start. `null` text means there is nothing to list. */
export type SkillIndex = {
  text: string | null
  /** The folders an agent must be able to read, one per delivered skill. Never the data root. */
  folders: string[]
  delivered: string[]
  omitted: string[]
}

// About 4,000 tokens. Enough for a dozen skills with full-length descriptions; the rest are counted,
// named in settings, and left out whole rather than cut mid-sentence.
export const MAX_SKILL_INDEX_BYTES = 16 * 1024

const HEADER = 'These are procedures you can load. Read the file when a task matches the description.'

export function skillIndex(skills: readonly DeliverableSkill[], maxBytes = MAX_SKILL_INDEX_BYTES): SkillIndex {
  const lines: string[] = []
  const index: SkillIndex = { text: null, folders: [], delivered: [], omitted: [] }
  let bytes = Buffer.byteLength(HEADER, 'utf8') + 200
  for (const skill of skills) {
    const line = `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ').trim()} (${skill.file})`
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (bytes + size > maxBytes) {
      index.omitted.push(skill.name)
      continue
    }
    bytes += size
    lines.push(line)
    index.delivered.push(skill.name)
    index.folders.push(skill.dir)
  }
  if (!lines.length) return index
  const more = index.omitted.length ? `\n${index.omitted.length} more did not fit in this list.` : ''
  return { ...index, text: `${HEADER}\n\n${lines.join('\n')}${more}` }
}

/** What the first turn after a start carried, for the catalogue, the session row, and the transcript. */
export type SkillReport = {
  /** Loaded by the harness itself, by plugin skill name. */
  native: string[]
  /** In the index, and left out of it for room. */
  delivered: string[]
  omitted: string[]
  /** Named to the agent before and gone now, as it was told them. */
  removed: string[]
  /** What the agent knows of now: native names, then indexed names. The session row keeps it. */
  told: string[]
  /** Why the native folder couldn't be written, when it couldn't. */
  failure?: string
}

export type SkillStart = {
  /** Every folder this start may point the agent at, for a harness that needs a read grant. */
  folders: readonly string[]
  /** The plugin folders a harness with its own skill support loads. Empty without one. */
  plugins: readonly string[]
  /** The part and report for the first turn, given the names the harness has advertised by then.
   *  `null` when there is nothing to send or record. */
  firstTurn(advertised: ReadonlySet<string>): { part: AgentContextSnapshot | null; report: SkillReport } | null
  /** Removes this start's folder. Call it once the process is done. Never throws. */
  retire(): Promise<void>
}

const told = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : []

// Names, because an earlier list stays in the conversation's history on every harness, and a native
// one does too: neither Claude Code nor Codex tells the model a skill went away on resume.
const removedText = (names: readonly string[]) =>
  `These procedures were removed and can't be loaded now, even if an earlier list in this conversation names them: ${names.join(', ')}.`

/**
 * Plans one start. `folder` is where to write the native copy, for a harness with its own skill support,
 * or `null`. `lastTold` is the session row's record of what the agent was told before.
 */
export async function prepareSkillStart(
  skills: readonly DeliverableSkill[],
  options: { folder: string | null; lastTold: unknown },
): Promise<SkillStart> {
  let native: DeliverableSkill[] = []
  let plugins: string[] = []
  let failure: string | undefined
  if (options.folder && skills.length) {
    try {
      const written = await writeSkillFolder(options.folder, skills)
      native = written.skills
      plugins = written.plugins
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      await removeSkillFolder(options.folder).catch(() => undefined)
    }
  }
  const portable = native.length ? [] : skills
  const before = told(options.lastTold)
  return {
    folders: [...native, ...portable].map((skill) => skill.dir),
    plugins,
    firstTurn(advertised) {
      const loaded = native.filter((skill) => advertised.has(nativeSkillName(skill.name)))
      const index = skillIndex(
        [...portable, ...native.filter((skill) => !loaded.includes(skill))].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      )
      const now = [...loaded.map((skill) => nativeSkillName(skill.name)), ...index.delivered]
      // A native skill not advertised yet may still load, and an omitted one is still on. Neither is gone.
      const kept = new Set([...now, ...native.map((skill) => nativeSkillName(skill.name)), ...index.omitted])
      const removed = before.filter((name) => !kept.has(name))
      if (!skills.length && !removed.length) return null
      const content = [index.text, removed.length ? removedText(removed) : null].filter(Boolean).join('\n\n')
      return {
        part: content
          ? {
              type: 'context',
              contextId: 'skills',
              source: 'context.skills',
              label: 'Skills',
              content,
              capturedAt: Date.now(),
            }
          : null,
        report: {
          native: loaded.map((skill) => skill.name),
          delivered: index.delivered,
          omitted: index.omitted,
          removed,
          told: now,
          ...(failure ? { failure } : {}),
        },
      }
    },
    retire: () => (options.folder ? removeSkillFolder(options.folder).catch(() => undefined) : Promise.resolve()),
  }
}

/** The transcript's one line about a start's skills. */
export function skillReportLine(report: SkillReport): string {
  const loadable = [...report.native.map((name) => `${nativeSkillName(name)} (native)`), ...report.delivered]
  return [
    report.failure
      ? `Couldn't prepare the harness's own skill folder (${report.failure}), so every skill went in acorn's list.`
      : null,
    loadable.length
      ? `Skills the agent can load: ${loadable.join(', ')}.`
      : report.omitted.length
        ? 'No skills fit in the list.'
        : null,
    report.omitted.length ? `${report.omitted.length} more didn't fit: ${report.omitted.join(', ')}.` : null,
    report.removed.length ? `The agent was told these are gone: ${report.removed.join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}
