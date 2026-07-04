// formatContextBlock (docs/next 11 §C/§D): the PUSH-path rendering of an assembled TaskContext —
// compact per the Cloudflare mantra ("the primary agent should never burn context on storage
// strategy"): titles not bodies, the memory INDEX not memory bodies, stable ordering. The agent
// pulls detail on demand via the MCP tools.
import type { TaskContext } from './api'

const PR_BODY_CAP = 600
const FILES_CAP = 30

export function formatContextBlock(ctx: TaskContext): string {
  const lines: string[] = [`# Task: ${ctx.task.title} (${ctx.task.repo} · ${ctx.task.branch})`]
  if (ctx.pr) {
    lines.push('', `## PR #${ctx.pr.number}: ${ctx.pr.title}`)
    const body = ctx.pr.body?.replace(/<[^>]+>/g, '').trim()
    if (body) lines.push(body.length > PR_BODY_CAP ? `${body.slice(0, PR_BODY_CAP)}…` : body)
    if (ctx.pr.changedFiles.length) {
      const shown = ctx.pr.changedFiles.slice(0, FILES_CAP)
      const more = ctx.pr.changedFiles.length - shown.length
      lines.push(`Changed files (${ctx.pr.changedFiles.length}): ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`)
    }
  }
  if (ctx.issues.length) {
    lines.push('', '## Linked issues')
    for (const i of ctx.issues) lines.push(`- [${i.provider}] ${i.identifier} — ${i.title}${i.detail ? ` (${i.detail})` : ''}`)
  }
  if (ctx.notes.length) {
    lines.push('', '## Notes')
    for (const n of ctx.notes) {
      lines.push(`### ${n.title}`, n.body.trim())
    }
  }
  if (ctx.memory.length) {
    lines.push('', '## Repo memory (index — ask for bodies via memory_get)')
    for (const m of ctx.memory) lines.push(`- ${m.name} — ${m.description}`)
  }
  return lines.join('\n')
}
