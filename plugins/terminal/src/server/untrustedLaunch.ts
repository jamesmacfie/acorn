// An agent's interactive launch in an untrusted project (docs/workspaces-and-tasks/projects.md §
// Untrusted projects). Loaded on first use, to stay inside the service boot budget
// (apps/node/scripts/check-service-budget.mjs).
import { UNTRUSTED_REPOSITORY_PROMPT, untrustedLaunchArgs, type AgentProfileContribution } from '@acorn/plugin-api/node'

/** The profile's launch argv with its lock-down flags in front and the untrusted line ahead of the task
 *  context. Throws for a profile that can't lock down. */
export function untrustedTerminalArgs(profile: AgentProfileContribution, context: string | null): string[] {
  const args = profile.launchContextArgs
    ? profile.launchContextArgs([UNTRUSTED_REPOSITORY_PROMPT, context].filter(Boolean).join('\n\n'))
    : (profile.launchArgs ?? [])
  return untrustedLaunchArgs(profile, args)
}
