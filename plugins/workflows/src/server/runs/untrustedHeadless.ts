// A workflow step's headless or one-shot agent in an untrusted project
// (docs/workspaces-and-tasks/projects.md § Untrusted projects). Loaded on first use, to stay inside the
// service boot budget (apps/node/scripts/check-service-budget.mjs).
import { UNTRUSTED_REPOSITORY_PROMPT, untrustedLaunchArgs, type AgentProfileContribution } from '@acorn/plugin-api/node'

export const untrustedPrompt = (prompt: string): string => `${UNTRUSTED_REPOSITORY_PROMPT}\n\n${prompt}`

/** The argv with the profile's lock-down flags in front. Throws for a profile that can't lock down. */
export const untrustedArgv = (profile: AgentProfileContribution, argv: { file: string; args: string[] }) => ({
  file: argv.file,
  args: untrustedLaunchArgs(profile, argv.args),
})
