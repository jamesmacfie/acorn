// A harness as data: everything the generic ACP driver needs to start an agent and describe it.
// See docs/managed-agents.md § Harnesses for the two driver tiers and which one a new agent belongs in.
//
// The internal shape. Its data-only twin is the `harnesses` manifest contribution
// (@acorn/protocol/plugin/contract.ts), which the delivery seam converts into one of these. They differ
// only where a manifest cannot carry a function: `entry` resolves a path here and is a package-relative
// string there, and `probeAuth` is a call here and a route there.
import type { AgentCapability } from '@acorn/protocol/managedAgents.ts'

/** What the protocol cannot ask the agent, so the harness declares it. A quirk joins this list when a
 *  second harness needs it. See docs/plugin-authoring.md § Harnesses. */
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
  // A JS file run with the node service's own binary, for an agent that needs an adapter in front of it.
  // A function, not a path, because the two feeders resolve it differently: a built-in harness goes
  // through `createRequire`, a contributed one joins its installed package directory. Both resolve at
  // probe time, so a missing adapter is a diagnostic rather than a boot failure.
  | {
    entry: () => string
    args?: readonly string[]
    // The CLI the adapter drives. Its resolved absolute path reaches the child as `env`. Named rather
    // than templated, so the manifest carries data a person can read.
    requires?: { command: string; env: string }
  }

export type HarnessLaunchSpec = {
  /** Persisted as a session row's `providerId`. Renaming one breaks every stored row. */
  id: string
  /** Persisted as a session row's `profileId` and a workflow step's `profile`. Usually the same as
   *  `id`. `claude`/`claude-code` differ because both names predate this seam. */
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
// normalizer maps all of them (./acpNormalizer.ts). A descriptor is built before the child
// is spawned, so this is what the protocol guarantees, not what one agent negotiated.
//
// The negotiated set is narrower and arrives at `initialize`. The model and mode pickers read
// `configOptions` from that same response, so nothing downstream has to guess from the descriptor.
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
