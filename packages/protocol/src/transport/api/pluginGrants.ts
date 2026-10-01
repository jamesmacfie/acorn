import type { ExtensionPointKind, HookMode } from '../../chrome/extensionPoints.ts'
import type { Cadence } from '../../runtime/schedules.ts'

// The frame grants the device derives from a manifest's surfaces and records against a trust
// decision. Not manifest shapes: they're what the owner consented to, one row per surface.
export type PluginWebviewGrant = { surface: string; label: string; hosts: string[] }
export type PluginKeyClaimGrant = { surface: string; label: string; chords: string[] }
// A host-mediated jump from this package's UI into a target another client plugin owns. The target is
// a notice kind, never a pane id or route; storing it makes a newly added cross-owner destination
// visible in the update prompt.
export type PluginNavigationDestinationGrant = {
  surface: string
  label: string
  destination: string
  targetKind: string
  noticeKind?: string
}

// The third grant: what this package's manifest says about other packages and about core's own
// surfaces (@acorn/protocol/extensionPoints.ts). One shape for all three kinds rather than three
// arrays, because they answer one question an owner asks once, "what does this reach that isn't its
// own?", and three near-identical lists are three places to forget one.
//
//   hosts     this package opens one of its surfaces to other packages' rows.
//   extends   this package puts its rows inside another package's surface. `target` names that package.
//   replaces  this package offers to draw one of core's own surfaces. Nothing is replaced until the
//             owner picks it in settings.
export type PluginExtensionGrant = {
  kind: 'hosts' | 'extends' | 'replaces'
  // Which of the five things is opened, or brought (@acorn/protocol/extensionPoints.ts). Absent on
  // `replaces`, which is the exclusive slot rather than a point. On `extends` it is derived from the
  // carrier this manifest named, because a contributor cannot see the owner's declaration.
  pointKind?: ExtensionPointKind
  // `hook` contributions only: what the handler asks to do. It is the difference between "can watch a
  // push" and "can stop a push", so it belongs in the grant and in the key.
  mode?: HookMode
  // A point reference, or a designated core slot id. Never free text.
  target: string
  label: string
}

// The fourth grant: periodic work the node runs for this package with no client open
// (docs/schedules.md). Recorded rather than merely shown, because the update prompt's "what's new"
// mark is a set difference against what the owner last approved. A package that starts running itself
// every five minutes where it used to run daily has grown its reach.
export type PluginScheduleGrant = { id: string; label: string; cadence: Cadence }

// The fifth grant: a check this package runs when the owner archives a task, and whether it offers to
// clean up after it (node-core/server/pluginHost/taskChecks.ts). Recorded for the same reason as the
// fourth: `cleansUp` in the key is what lets the update prompt say a package that used to only warn
// now does something.
export type PluginTaskCheckGrant = { id: string; cleansUp: boolean }

// The sixth grant, and the only one under `Enforced` that names a program: a managed agent harness
// this package asks acorn to run (docs/managed-agents.md § Harnesses). The claim is exact, since the
// host spawns the declared command with the declared args and nothing else, so the whole spawn goes
// in the key. A version that runs a different binary, or carries more of the node's environment into
// it, has to reach the update prompt.
export type PluginHarnessGrant = {
  id: string
  label: string
  // `command` is an executable off PATH. `entry` is JavaScript this package ships, run with the node
  // service's own binary.
  kind: 'command' | 'entry'
  // The command line, or the package-relative entry path, with its declared arguments.
  run: string
  // Config variables carried from the node's environment into the agent, by name or glob.
  env: string[]
  // The second invocation, when the harness declares a one-shot text mode: the same command line the
  // Generate lists spend. Absent means the harness runs only as a session.
  oneShot?: string
}

// Loaded tool and context descriptors are executable/data-bearing surfaces in the same trust
// snapshot as schedules and harnesses. Routes are intentionally absent: manifest validation binds
// those to the declaring package, while these fields capture every way an update can widen what the
// host will expose or return.
export type PluginAgentToolGrant = {
  id: string
  description: string
  risk: 'read' | 'write' | 'execute'
  requiresSession: boolean
  maxOutputBytes: number
}

export type PluginContextSectionGrant = {
  id: string
  label: string
  defaultIncluded: boolean
  maxBytes: number
  maxTokens: number
}

// A custom agent a package contributes. The instructions are the grant: they are text the package puts
// into the system prompt of every session an owner starts from it, so the prompt shows them in full and
// a changed text asks again (docs/managed-agents.md § Custom agents).
export type PluginCustomAgentGrant = {
  id: string
  name: string
  harness: string
  instructions: string | null
  maxToolRisk: 'read' | 'write' | 'execute' | null
}
