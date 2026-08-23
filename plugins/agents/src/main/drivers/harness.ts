// A harness as data: everything the generic ACP driver needs to start an agent and describe it.
// See docs/managed-agents.md § Harnesses for the two driver tiers and which one a new agent belongs in.
//
// This is the internal shape. Its data-only twin is the `harnesses` manifest contribution
// (@acorn/protocol/pluginContract.ts), which the delivery seam converts into one of these. The two
// differ in exactly the places a manifest cannot carry a function: `entry` resolves a path here and is
// a package-relative string there, and `probeAuth` is a call here and a route there.
import type { AgentCapability } from '@acorn/protocol/managedAgents.ts'

/** What the protocol cannot ask the agent, so the harness declares it. See the growth rule in
 *  docs/plugin-authoring.md § Harnesses: a quirk joins this list when a second harness needs it, and
 *  each one names the affordance it gates. */
export type HarnessQuirks = {
  /** The agent accepts an explicit compaction request. Gates the pane's Compact action. */
  manualCompaction?: boolean
  /** Sessions outlive the agent process and can be reloaded. Gates resume, and with it the terminal
   *  handoff and every "continue where you left off" path. */
  sessionPersistence?: boolean
}

export type HarnessSpawn =
  // An executable on PATH. The user installs the CLI; the descriptor's diagnostics say so when it is
  // missing.
  | { command: string; args?: readonly string[] }
  // A JS file run with the node service's own binary, for an agent that does not speak ACP natively and
  // needs an adapter in front of it. A function rather than a path because the two feeders resolve it
  // differently: a built-in harness resolves a desktop dependency through `createRequire`, a contributed
  // one joins its installed package directory. Either way the resolution happens at probe time, so a
  // missing adapter is a diagnostic rather than a boot failure.
  | {
    entry: () => string
    args?: readonly string[]
    // The CLI the adapter drives, whose resolved absolute path is passed to the child as `env`. Named
    // rather than templated: the manifest carries data a person can read, not a program.
    requires?: { command: string; env: string }
  }

export type HarnessLaunchSpec = {
  /** Persisted as a session row's `providerId`. Renaming one is a compatibility break across every
   *  stored row (docs/managed-agents.md § Harnesses: the id constraint). */
  id: string
  /** Persisted as a session row's `profileId` and a workflow step's `profile`. Usually the same as `id`;
   *  `claude`/`claude-code` differ only because both were minted before this seam existed. */
  profileId: string
  label: string
  /** A Lucide name or a `brand:` mark, drawn wherever a surface names the harness. Absent means the
   *  surfaces fall back to the label's first letter. */
  glyph?: string
  spawn: HarnessSpawn
  /** Static child env, on top of the broker's base allowlist. */
  env?: Record<string, string>
  /** Config variables to carry through from the node's own environment, by name or `PREFIX_*` glob.
   *  Configuration only, never credentials: see the note on the generic driver's spawn. */
  envPassthrough?: readonly string[]
  quirks?: HarnessQuirks
  /** Whether the harness's own account is logged in, for the Agent Center's provider-health row.
   *  Absent means the row shows installed-or-not only. */
  probeAuth?: (executable: string) => Promise<boolean | null>
}

// What any ACP harness can carry, because the protocol defines these update kinds and the shared
// normalizer maps every one of them (main/drivers/acpNormalizer.ts). This replaces the twelve-entry
// array the Claude driver used to hardcode, which on a generic driver would be a lie about every
// harness at once: the list has to be either derived from the wire or true of the protocol, and only
// the second is knowable before the child is spawned.
//
// The negotiated set is narrower and arrives at `initialize`. What the client actually branches on
// from it — the model and mode pickers — reads `configOptions`, which the live session emits from that
// same response, so nothing downstream needs the descriptor to guess.
const ACP_BASELINE: readonly AgentCapability[] = [
  'streaming_messages',
  'reasoning',
  'tool_calls',
  'plans',
  'permissions',
  'commands',
  'usage',
  'file_changes',
  'attachments',
]

export const harnessCapabilities = (quirks: HarnessQuirks | undefined): AgentCapability[] => [
  ...ACP_BASELINE,
  ...(quirks?.sessionPersistence ? (['resume'] as const) : []),
  ...(quirks?.manualCompaction ? (['compact'] as const) : []),
]
