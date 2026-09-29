import { z } from 'zod'

export const toolRiskSchema = z.enum(['read', 'write', 'execute'])
export const toolPermissionsSchema = z.strictObject({
  tiers: z.partialRecord(toolRiskSchema, z.boolean()).optional(),
  tools: z.record(z.string().min(1), z.boolean()).optional(),
})
export type ToolPermissions = z.infer<typeof toolPermissionsSchema>

// What a tier means when the owner has never expressed an opinion about it, which is the state every
// installation is in for a tool that ships in a later release.
//
// `execute` is denied. It covers the tools that run a command in the worktree, and a `true` fallback
// meant that adding one granted it to every existing installation, silently, on upgrade — the owner
// had approved a list that no longer described what the agent could do. Denied by default, a new
// execute tool is inert until someone turns the tier on in Settings → Agent tools.
//
// `read` and `write` stay allowed, and are written out rather than left implicit so the next tier
// added has to say which it is. Read has no side effects. Write reaches notes and memory proposals,
// both of which are acorn's own records rather than the machine, and memory proposals stay behind the
// human review gate whatever this says.
export const TOOL_TIER_DEFAULTS: Record<z.infer<typeof toolRiskSchema>, boolean> = {
  read: true,
  write: true,
  execute: false,
}
