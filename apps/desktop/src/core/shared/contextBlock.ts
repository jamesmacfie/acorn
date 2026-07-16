import type { TaskContext } from './api'

// Every section contribution owns its compact projection. This renderer only supplies the stable
// task frame and ordering, so a new section reaches push, workflow and MCP paths automatically.
export function formatContextBlock(ctx: TaskContext): string {
  const sections = ctx.sections.map((section) => section.compact.trim()).filter(Boolean)
  return [`# Task: ${ctx.task.title} (${ctx.task.repo} · ${ctx.task.branch})`, ...sections].join('\n\n')
}

// Launch-time variant (docs/notes-and-memory.md): the block auto-injected as an agent's first
// prompt. Same section compacts, but each is introduced by a plain-language lead-in so the agent
// knows why it's being handed the material. Sections with no content are dropped.
const LAUNCH_LEADINS: Record<string, string> = {
  pr: 'This session is for the following GitHub pull request:',
  issues: 'You may find these linked issues relevant:',
  notes: 'The user has written the following notes you may find relevant:',
}

export function formatLaunchContext(ctx: TaskContext): string {
  const parts = ctx.sections
    .map((section) => {
      const compact = section.compact.trim()
      if (!compact) return ''
      const leadIn = LAUNCH_LEADINS[section.id]
      return leadIn ? `${leadIn}\n\n${compact}` : compact
    })
    .filter(Boolean)
  if (!parts.length) return ''
  return [`# Task: ${ctx.task.title} (${ctx.task.repo} · ${ctx.task.branch})`, ...parts].join('\n\n')
}
