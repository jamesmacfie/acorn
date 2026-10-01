import { z } from 'zod'
import { cadenceSchema } from '../../runtime/schedules.ts'
import { entry, pluginRoute } from './manifestFields.ts'

// Periodic work the node runs for this plugin, with no client open. The pair to
// `ctx.schedules.register`: two feeders, one registry, indistinguishable downstream. A manifest is also
// how the owner is told, because a schedule acts while nobody is watching. See docs/schedules.md.
export const scheduleDescriptor = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  // POST { scheduleId }. Confined to the plugin's route namespace at parse and re-checked on the node
  // before each run. The response is ignored beyond ok or error.
  run: pluginRoute,
  // The plugin floor (300s) isn't spelled here. It's enforced on read from the key's owner prefix
  // (node-core/server/schedules/scheduler.ts § floorFor), so declaring under a plugin key opts in.
  cadence: cadenceSchema,
  // Seconds, and the one unit trap in this feature: the engine's DeclaredSchedule.timeoutMs is
  // milliseconds and the host converts. Absent means the engine default of 60s.
  timeout: z.number().int().min(1).max(300).optional(),
})

// A check the host runs before it archives a task, and the cleanup the owner may opt into. The pair to
// `ctx.taskChecks.register`. Node-side, because the question is about a worktree and the processes
// around it. See docs/plugins.md § Task checks.
export const taskCheckDescriptor = z.object({
  id: z.string().min(1).max(64),
  // GET ?taskId=… → { concern } | { concern: null }. Confined to this plugin's own namespace at parse
  // time and re-confined on every dispatch, exactly like `items` and `run`.
  check: pluginRoute,
  // POST { taskId }, run only when the concern offered an action and the owner left it ticked. Absent
  // means advisory: the host draws no checkbox even if the check's answer asks for one, because a
  // checkbox with nothing behind it is worse than none.
  apply: pluginRoute.optional(),
  // Seconds, for the check only. Absent means the host default, and the host ceiling wins either way:
  // the owner is waiting on a dialog (node-core/server/pluginHost/taskChecks.ts).
  timeout: z.number().int().min(1).max(10).optional(),
})

// One verb this plugin will write onto the node's audit trail (docs/security.md § Audit). The host
// qualifies it as `<pluginId>:<id>`, so a package cannot file a row under a core verb or another
// plugin's, and the settings surface can still enumerate the whole vocabulary because every entry in it
// came from a parsed manifest or from core's own closed union.
//
// The declaration lets settings enumerate each action. The host refuses a plugin recording an action
// it did not declare.
export const auditActionDescriptor = z.object({
  // Dots, not colons: the colon is the host's separator. `run.finished`, not `workflows:run.finished`.
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9.-]*$/, 'audit action id must be lower-case alphanumeric with dots and dashes'),
  // What the settings row calls it. The raw verb is honest but unreadable, and a plugin knows its own
  // wording better than a lookup table in the shell does.
  label: z.string().min(1).max(80),
})

// ── Managed agent harnesses (docs/managed-agents.md § Harnesses) ──────────────────────────────────
//
// A harness is data. The contributing plugin describes the spawn, and plugins/agents owns the child
// process, the session, and the transcript, so a data-only harness plugin needs no `exec` grant.
// docs/plugin-authoring.md § Harnesses is the authoring contract.

// A variable name, or a `PREFIX_*` glob. A bare `*` is refused here and in `brokerEnv`: it would copy
// the node's whole environment into the agent and defeat the allowlist.
const envName = z.string().min(1).max(64).regex(
  /^[A-Za-z_][A-Za-z0-9_]*\*?$/,
  'env passthrough must be a variable name or a PREFIX_* glob',
)

// Exactly one of `command` and `entry`, checked in node-core/server/plugins/manifest.ts because a
// refinement here cannot name the field path inside the containing descriptor.
const harnessSpawn = z.object({
  // An executable resolved on PATH. The user installs the CLI, and the harness diagnostics report it
  // when missing.
  command: z.string().min(1).max(128).optional(),
  // A package-relative JS file, run with the node service's own binary, for an adapter in front of an
  // agent that does not speak ACP. Confined to the installed package directory at parse time.
  entry: entry.optional(),
  args: z.array(z.string().min(1).max(256)).max(16).default([]),
  // `entry` only: the CLI the adapter drives. Its resolved absolute path reaches the child as the named
  // variable.
  requires: z.object({
    command: z.string().min(1).max(128),
    env: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/, 'env must be an upper-case variable name'),
  }).optional(),
})

// What ACP does not carry, declared per harness rather than hardcoded as an id list inside acorn.
const harnessQuirks = z.object({
  // The agent implements a compaction command, so the pane may offer Compact.
  manualCompaction: z.boolean().default(false),
  // Sessions outlive the agent process and can be reloaded, so resume and the terminal handoff exist.
  sessionPersistence: z.boolean().default(false),
})

// One prompt in, one answer out, with no session and no tools. Declaring it is what puts the harness
// in every Generate list beside a connected API key (docs/integrations.md § Model providers), and it
// is the only argv a manifest may assemble.
//
// It sits beside `terminal` rather than inside it, because answering one question and holding a
// conversation are two different things an agent may do, and some agents do only one. DeepSeek is the
// case that proved it: `dsh --profile headless` answers a prompt and exits, and `dsh` on its own has
// no interactive mode at all, so nesting this under a required interactive command locked it out of a
// list it belongs in.
//
// `headlessArgv` and `resumeArgv` stay refused, because a manifest that can say "if resuming, add
// these two arguments" is a template language. This one is admitted because it has two variables in
// fixed positions and nothing to branch on: the model goes after `args` when a caller names one and
// the CLI has a flag for it, and the prompt is always last. The line we hold is that `oneShot` never
// grows a placeholder syntax. A CLI that wants the prompt in the middle, or a flag whose value
// depends on another flag, is asking for a code-tier profile instead.
const harnessOneShot = z.object({
  // The executable, for a harness that declares no `terminal` to borrow one from. A harness has exactly
  // one binary, because it is reported as installed or not by looking one up on PATH, so declaring this
  // beside a `terminal` is refused rather than resolved. Both rules are in
  // node-core/server/plugins/manifest.ts.
  command: z.string().min(1).max(128).optional(),
  // The subcommand and switches that make the CLI answer once and exit, such as `run` for opencode.
  // Written out rather than defaulted, because this is the invocation the trust prompt discloses.
  args: z.array(z.string().min(1).max(256)).max(16),
  // Omitted means the CLI answers on whatever model it is configured with, and a model a caller names
  // is dropped rather than guessed at.
  modelFlag: z.string().min(1).max(64).optional(),
  // How stdout is read. `text` takes all of it as the answer, which suits a CLI that prints the answer
  // and sends its own chrome to stderr. `json-lines` reads a newline-delimited stream and looks for a
  // `result` event, the shape `claude -p --output-format stream-json` writes.
  //
  // The one field here with no default, unlike the rest of this descriptor, because there is no common
  // case to default to: of the four agent CLIs acorn drives, one writes a `result` event and the others
  // do not. A wrong guess reads as a malformed run with nothing on screen to say why, so we make the
  // author state it.
  output: z.enum(['text', 'json-lines']),
})

// The interactive TUI beside the managed session: the data half of an agent profile. Declaring it is
// what offers the harness in a task terminal, so a harness with no interactive mode leaves it out.
// `headlessArgv`, `resumeArgv` and a stream shape of the harness's own have no manifest form, so a
// data-only harness runs no agentic workflow step.
const harnessTerminal = z.object({
  command: z.string().min(1).max(128),
  backendPreference: z.enum(['node-pty', 'tmux']).default('tmux'),
  launchArgs: z.array(z.string().min(1).max(4_096)).max(16).default([]),
})

export const harnessDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, then persisted as a session row's `providerId` and
  // `profileId`. Renaming one breaks every session the plugin's users already have.
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  // A Lucide name or a `brand:` mark; `brand:<pluginId>` is this manifest's own `icon`.
  glyph: z.string().min(1).max(64).optional(),
  spawn: harnessSpawn,
  // Config variables carried through from the node's environment. Configuration only: the broker's base
  // allowlist omits `ANTHROPIC_*` and `OPENAI_*`, and an agent CLI authenticates through its own stored
  // login. Disclosed in the trust prompt.
  envPassthrough: z.array(envName).max(32).default([]),
  quirks: harnessQuirks.prefault({}),
  // Routes on this plugin's own node half, confined to its own namespace at parse time. `usage` answers
  // the plan-usage snapshot for the Agent pane, `auth` whether the harness's account is signed in.
  // Absent means the matching surface shows less.
  probes: z.object({
    usage: pluginRoute.optional(),
    auth: pluginRoute.optional(),
  }).optional(),
  terminal: harnessTerminal.optional(),
  // One contained text turn. Independent of `terminal`: a harness may offer both, either, or neither.
  oneShot: harnessOneShot.optional(),
})
