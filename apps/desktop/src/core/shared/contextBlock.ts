import type { TaskContext } from './api'

// Every section contribution owns its compact projection. This renderer only supplies the stable
// task frame and ordering, so a new section reaches push, workflow and MCP paths automatically.
export function formatContextBlock(ctx: TaskContext): string {
  const sections = ctx.sections.map((section) => section.compact.trim()).filter(Boolean)
  return [`# Task: ${ctx.task.title} (${ctx.task.repo} · ${ctx.task.branch})`, ...sections].join('\n\n')
}
