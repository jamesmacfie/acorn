// The skills index a provider receives at every start and resume (docs/managed-agents/skills.md §
// Delivery). Names, descriptions and the absolute path of each `SKILL.md`, under one fixed sentence from
// acorn. The agent reads a body only when a task matches, so ten skills cost ten lines.
//
// Built once per start by the lifecycle, which sends it as a context part ahead of the first turn after
// that start, on every harness. Not in a system prompt: Claude Code keeps the one a session was created
// with, so a resumed session would keep a skill the owner switched off. The lifecycle reports
// `delivered` and `omitted` only once the turn that carried the index has run.
import { createHash } from 'node:crypto'
import type { DeliverableSkill } from '@acorn/plugin-api/node'
import type { AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'

/** What one provider start receives. `null` text means there is nothing to say. */
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

export const EMPTY_SKILL_INDEX: SkillIndex = { text: null, folders: [], delivered: [], omitted: [] }

export function skillIndex(skills: readonly DeliverableSkill[], maxBytes = MAX_SKILL_INDEX_BYTES): SkillIndex {
  if (!skills.length) return EMPTY_SKILL_INDEX
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
  if (!lines.length) return { ...index, text: null }
  const more = index.omitted.length ? `\n${index.omitted.length} more did not fit in this list.` : ''
  return { ...index, text: `${HEADER}\n\n${lines.join('\n')}${more}` }
}

// For a session that was told about skills before and now has none, so an earlier list in its history
// stops applying.
const WITHDRAWN = 'No procedures are available to load now. Earlier lists of procedures in this conversation no longer apply.'

/** What the session row keeps of the last index a turn carried. Empty means none. */
export const skillIndexDigest = (index: SkillIndex): string =>
  index.text ? createHash('sha256').update(index.text).digest('hex').slice(0, 16) : ''

/** The part owed ahead of the first turn after a start: the index whenever there is one, because a fresh
 *  provider session has never seen it and a resumed one may have compacted it away, or the withdrawal
 *  when the session last received an index and now has none. */
export function owedSkillPart(index: SkillIndex, lastDigest: unknown): AgentContextSnapshot | null {
  const content = index.text ?? (typeof lastDigest === 'string' && lastDigest ? WITHDRAWN : null)
  return content ? { type: 'context', contextId: 'skills', source: 'context.skills', label: 'Skills', content, capturedAt: Date.now() } : null
}
