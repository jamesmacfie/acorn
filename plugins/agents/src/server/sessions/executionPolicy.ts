import type { AgentConfigOption, AgentSession } from '../../contract/wire.ts'

// Each harness's setting for how much it does before a person approves it, ranked on one scale so a
// child on one harness compares with a parent on another:
//   0. A person approves each command, or the command doesn't run.
//   1. File edits run unasked, or commands run in a read-only sandbox.
//   2. Commands run unasked, checked by a classifier or held in a workspace sandbox.
//   3. Commands run unasked with neither (`unguardedSetting`).
// Codex's `mode` is its collaboration mode, which grants nothing, so its setting is `permissions`. The
// unprefixed Codex values are the older sandbox-mode names of the same profiles.
//
// `asking` is the value that asks a person before each command and still lets the agent work. Claude
// Code's `default` asks for every shell command the owner's own settings don't allow. Codex has none,
// because it reports its sandbox but not its approval policy.
const EXECUTION_POLICY: Record<string, { optionId: string; ranks: Record<string, number>; asking?: string }> = {
  claude: {
    optionId: 'mode',
    ranks: { plan: 0, dontAsk: 0, default: 0, acceptEdits: 1, auto: 2, bypassPermissions: 3 },
    asking: 'default',
  },
  codex: {
    optionId: 'permissions',
    ranks: {
      ':read-only': 1,
      'read-only': 1,
      ':workspace': 2,
      'workspace-write': 2,
      ':danger-full-access': 3,
      'danger-full-access': 3,
    },
  },
}

/** The option that carries this harness's execution policy, or undefined for a harness not listed. */
export const executionPolicyOptionId = (providerId: string): string | undefined =>
  EXECUTION_POLICY[providerId]?.optionId

/** The option and value under which this harness asks before each command, or undefined when it has none. */
export function askingSetting(providerId: string): { optionId: string; value: string } | undefined {
  const policy = EXECUTION_POLICY[providerId]
  return policy?.asking ? { optionId: policy.optionId, value: policy.asking } : undefined
}

/** The rank of one value of the harness's policy option, or null when the table doesn't know it. */
export function executionPolicyValueRank(providerId: string, value: string | null | undefined): number | null {
  const ranks = EXECUTION_POLICY[providerId]?.ranks
  // Own keys only, so a reported value such as `toString` doesn't read the prototype.
  return ranks && value != null && Object.hasOwn(ranks, value) ? ranks[value]! : null
}

/** The rank of the setting a session reports, or null when it reports none this table knows. */
export function executionPolicyRank(providerId: string, configOptions: unknown): number | null {
  const optionId = executionPolicyOptionId(providerId)
  if (!optionId || !Array.isArray(configOptions)) return null
  const option = (configOptions as AgentConfigOption[]).find((candidate) => candidate.id === optionId)
  return executionPolicyValueRank(providerId, option?.currentValue)
}

/**
 * Splits what an agent asked of a session it delegates to. An agent picks only the model and the
 * reasoning: every other option can change what the harness does without a person, so it stays the
 * owner's. An option the session doesn't advertise is refused too, because its category is unknown.
 */
export function agentChosenOptions(
  advertised: unknown,
  wanted: Record<string, string>,
): { allowed: Record<string, string>; refused: string[] } {
  const options = Array.isArray(advertised) ? (advertised as AgentConfigOption[]) : []
  const allowed: Record<string, string> = {}
  const refused: string[] = []
  for (const [id, value] of Object.entries(wanted)) {
    const category = options.find((option) => option.id === id)?.category
    if (category === 'model' || category === 'reasoning') allowed[id] = value
    else refused.push(id)
  }
  return { allowed, refused }
}

/**
 * Why this session can't take an unattended turn at its current settings, or null when it can. Only a
 * session with an `executionCeiling` is checked: a delegated child whose parent reported its policy
 * (`delegatedExecutionCeiling`). A ceiling that isn't a number is unreadable and refuses every turn.
 */
export function executionPolicyRefusal(session: Pick<AgentSession, 'providerId' | 'config'>): string | null {
  const ceiling = session.config.executionCeiling
  if (ceiling === undefined) return null
  if (typeof ceiling !== 'number') return 'This agent has no readable permission limit, so it takes no turns.'
  const rank = executionPolicyRank(session.providerId, session.config.configOptions)
  if (rank === null) {
    return `This agent (${session.providerId}) doesn't report a permission mode Acorn knows, so Acorn can't keep it within what the agent that started it may do.`
  }
  if (rank > ceiling) {
    return "This agent is set to run with wider permissions than the agent that started it. Set its mode no wider than its parent's."
  }
  return null
}
