import { z } from 'zod'
import { cadenceSchema } from '../../runtime/schedules.ts'
import { entry, pluginRoute } from './manifestFields.ts'

// Periodic work the node runs for this plugin, with no client open. The pair to
// `ctx.schedules.register`: two feeders, one registry, indistinguishable downstream. A manifest is also
// how the owner is told, because a schedule acts while nobody is watching. See docs/schedules.md.
export const scheduleDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The schedule's ID, unique in this manifest."),
  name: z.string().min(1).max(80).describe("The schedule's name in Settings > Schedules and the trust prompt."),
  // POST { scheduleId }. Confined to the plugin's route namespace at parse and re-checked on the node
  // before each run. The response is ignored beyond ok or error.
  run: pluginRoute.describe(
    'A POST route on your Node half the Node calls each time, sent `{ scheduleId }`. Only success or failure is read from the answer.',
  ),
  // The plugin floor (300s) isn't spelled here. node-core's scheduler enforces it on read from the
  // key's owner prefix (`floorFor`), so declaring under a plugin key opts in.
  cadence: cadenceSchema.describe(
    "How often it runs: every so many seconds, daily, or weekly. A plugin's schedule runs at most every 300 seconds, whatever it asks.",
  ),
  // Seconds, and the one unit trap in this feature: the engine's DeclaredSchedule.timeoutMs is
  // milliseconds and the host converts. Absent means the engine default of 60s.
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .optional()
    .describe('How long one run may take, in seconds, not milliseconds. Defaults to 60.'),
})

// A check the host runs before it archives a task, and the cleanup the owner may opt into. The pair to
// `ctx.taskChecks.register`. Node-side, because the question is about a worktree and the processes
// around it. See docs/plugins/task-checks.md § Task checks.
export const taskCheckDescriptor = z.object({
  id: z.string().min(1).max(64).describe("The check's ID, unique in this manifest."),
  // GET ?taskId=… → { concern } | { concern: null }. Confined to this plugin's own namespace at parse
  // time and re-confined on every dispatch, exactly like `items` and `run`.
  check: pluginRoute.describe(
    "A GET route sent `taskId` that answers `{ concern }`, or `{ concern: null }` when there's nothing to say. Keep that answer cheap.",
  ),
  // POST { taskId }, run only when the concern offered an action and the owner left it ticked. Absent
  // means advisory: the host draws no checkbox even if the check's answer asks for one, because a
  // checkbox with nothing behind it is worse than none.
  apply: pluginRoute
    .optional()
    .describe(
      'A POST route that does the cleanup the concern offered, run only if the person leaves its box ticked. Leave it out for a warning with no cleanup.',
    ),
  // Seconds, for the check only. Parsed but not applied: every check runs under node-core's
  // `CHECK_TIMEOUT_MS`, because the owner is waiting on a dialog.
  timeout: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      "Seconds. Parsed but not used: every check runs under the Node's own short limit, because the person is waiting.",
    ),
})

// One verb this plugin will write onto the node's audit trail (docs/security/audit.md § Audit). The host
// qualifies it as `<pluginId>:<id>`, so a package cannot file a row under a core verb or another
// plugin's. Declaring it lets settings enumerate every action, and the host refuses a plugin recording
// an action it did not declare.
export const auditActionDescriptor = z.object({
  // Dots, not colons: the colon is the host's separator. `run.finished`, not `workflows:run.finished`.
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9.-]*$/, 'audit action id must be lower-case alphanumeric with dots and dashes')
    .describe(
      'The verb, in lowercase letters, digits, dots, and dashes, such as `run.finished`. No colon: the host makes it `<pluginId>:<id>`.',
    ),
  // What the settings row calls it. The raw verb is honest but unreadable, and a plugin knows its own
  // wording better than a lookup table in the shell does.
  label: z.string().min(1).max(80).describe('What the audit log calls the action.'),
})

// ── Managed agent harnesses (docs/managed-agents/harnesses.md § Harnesses) ──────────────────────────────────
//
// A harness is data. The contributing plugin describes the spawn, and plugins/agents owns the child
// process, the session, and the transcript, so a data-only harness plugin needs no `exec` grant.
// docs/plugin-authoring/harnesses.md § Harnesses is the authoring contract.

// A variable name, or a `PREFIX_*` glob. A bare `*` is refused here and in `brokerEnv`: it would copy
// the node's whole environment into the agent and defeat the allowlist.
const envName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*\*?$/, 'env passthrough must be a variable name or a PREFIX_* glob')

// Exactly one of `command` and `entry`, checked by node-core's `pluginManifestSchema` because a
// refinement here cannot name the field path inside the containing descriptor.
const harnessSpawn = z.object({
  // An executable resolved on PATH. The user installs the CLI, and the harness diagnostics report it
  // when missing.
  command: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('A program found on the `PATH`, such as `opencode`. Name `command` or `entry`, not both.'),
  // A package-relative JS file, run with the node service's own binary, for an adapter in front of an
  // agent that does not speak ACP. Confined to the installed package directory at parse time.
  entry: entry
    .optional()
    .describe(
      "A JavaScript file in your package that acorn runs with the Node's own runtime, for an adapter in front of an agent that doesn't speak ACP.",
    ),
  args: z.array(z.string().min(1).max(256)).max(16).default([]).describe('Arguments passed to the program.'),
  // `entry` only: the CLI the adapter drives. Its resolved absolute path reaches the child as the named
  // variable.
  requires: z
    .object({
      command: z.string().min(1).max(128).describe("The agent's program, looked up on the `PATH`."),
      env: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Z][A-Z0-9_]*$/, 'env must be an upper-case variable name')
        .describe("The variable that carries the program's full path to your adapter."),
    })
    .optional()
    .describe('With `entry`: the agent program your adapter drives.'),
})

// What ACP does not carry, declared per harness rather than hardcoded as an id list inside acorn.
const harnessQuirks = z.object({
  // The agent implements a compaction command, so the pane may offer Compact.
  manualCompaction: z
    .boolean()
    .default(false)
    .describe('The agent has a compact command, so the Agent pane offers Compact.'),
  // Sessions outlive the agent process and can be reloaded, so resume and the terminal handoff exist.
  sessionPersistence: z
    .boolean()
    .default(false)
    .describe("Sessions outlive the agent's process and can be loaded again, so resume works."),
})

// One prompt in, one answer out, with no session and no tools. Declaring it is what puts the harness
// in every Generate list beside a connected API key (docs/integrations/model-providers.md § Model providers), and it
// is the only argv a manifest may assemble.
//
// It sits beside `terminal` rather than inside it, because answering one question and holding a
// conversation are two different things an agent may do, and some agents do only one: `dsh --profile
// headless` answers a prompt and exits, and `dsh` on its own has no interactive mode.
//
// `headlessArgv` and `resumeArgv` stay refused, because a manifest that can say "if resuming, add
// these two arguments" is a template language. This one has two variables in fixed positions and
// nothing to branch on: the model goes after `args` when a caller names one and the CLI has a flag for
// it, and the prompt is always last. `oneShot` never grows a placeholder syntax. A CLI that wants the
// prompt in the middle, or a flag whose value depends on another flag, needs a code-tier profile.
const harnessOneShot = z.object({
  // The executable, for a harness that declares no `terminal` to borrow one from. A harness has exactly
  // one binary, because it is reported as installed or not by looking one up on PATH, so declaring this
  // beside a `terminal` is refused rather than resolved. node-core's `pluginManifestSchema` checks both.
  command: z
    .string()
    .min(1)
    .max(128)
    .optional()
    .describe('The program, when the harness has no `terminal` to take it from. Refused beside a `terminal`.'),
  // The subcommand and switches that make the CLI answer once and exit, such as `run` for opencode.
  // Written out rather than defaulted, because this is the invocation the trust prompt discloses.
  args: z
    .array(z.string().min(1).max(256))
    .max(16)
    .describe('The arguments that make the program answer once and exit, such as `["run"]`. The prompt goes last.'),
  // Omitted means the CLI answers on whatever model it is configured with, and a model a caller names
  // is dropped rather than guessed at.
  modelFlag: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('The flag that picks a model, such as `--model`. Leave it out and a model a caller names is dropped.'),
  // How stdout is read. `text` takes all of it as the answer, which suits a CLI that prints the answer
  // and sends its own chrome to stderr. `json-lines` reads a newline-delimited stream and looks for a
  // `result` event, the shape `claude -p --output-format stream-json` writes.
  //
  // No default, because agent CLIs split on this and there is no common case. A wrong guess reads as a
  // malformed run with nothing on screen to say why, so the author states it.
  output: z
    .enum(['text', 'json-lines'])
    .describe(
      'How to read the answer: `text` takes all of standard output, and `json-lines` looks for a `result` event in a stream of JSON lines.',
    ),
})

// The interactive TUI beside the managed session: the data half of an agent profile. Declaring it is
// what offers the harness in a task terminal, so a harness with no interactive mode leaves it out.
// `headlessArgv`, `resumeArgv` and a stream shape of the harness's own have no manifest form, so a
// data-only harness runs no agentic workflow step.
const harnessTerminal = z.object({
  command: z.string().min(1).max(128).describe("The agent's interactive program."),
  backendPreference: z.enum(['node-pty', 'tmux']).default('tmux').describe('How the terminal runs it.'),
  launchArgs: z.array(z.string().min(1).max(4_096)).max(16).default([]).describe('Arguments it starts with.'),
})

export const harnessDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, then persisted as a session row's `providerId` and
  // `profileId`. Renaming one breaks every session the plugin's users already have.
  id: z
    .string()
    .min(1)
    .max(64)
    .describe(
      "The harness's ID. The host makes it `<pluginId>:<id>` and stores it on every session, so renaming it breaks existing sessions.",
    ),
  label: z.string().min(1).max(80).describe("The harness's name where a person picks an agent."),
  // A Lucide name or a `brand:` mark; `brand:<pluginId>` is this manifest's own `icon`.
  glyph: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("A Lucide icon name, or a `brand:` mark. `brand:<pluginId>` is your manifest's `icon`."),
  spawn: harnessSpawn.describe('How acorn starts the agent for a managed session. It speaks ACP.'),
  // Config variables carried through from the node's environment. Configuration only: the broker's base
  // allowlist omits `ANTHROPIC_*` and `OPENAI_*`, and an agent CLI authenticates through its own stored
  // login. Disclosed in the trust prompt.
  envPassthrough: z
    .array(envName)
    .max(32)
    .default([])
    .describe(
      'Environment variables passed from the Node to the agent, by name or as a `PREFIX_*` glob. A bare `*` is refused, and the trust prompt lists them.',
    ),
  quirks: harnessQuirks.prefault({}).describe("What the agent supports that ACP doesn't say."),
  // Routes on this plugin's own node half, confined to its own namespace at parse time. `usage` answers
  // the plan-usage snapshot for the Agent pane, `auth` whether the harness's account is signed in.
  // Absent means the matching surface shows less.
  probes: z
    .object({
      usage: pluginRoute.optional().describe("A route that answers the account's plan usage, for the Agent pane."),
      auth: pluginRoute.optional().describe("A route that answers whether the agent's account is signed in."),
    })
    .optional()
    .describe("Routes on your Node half the Agent pane asks about the agent's account. Without them it shows less."),
  terminal: harnessTerminal
    .optional()
    .describe(
      "The agent's interactive program, offered in a task terminal. Leave it out for an agent with no interactive mode.",
    ),
  // One contained text turn. Independent of `terminal`: a harness may offer both, either, or neither.
  oneShot: harnessOneShot
    .optional()
    .describe('One prompt in, one answer out, with no session. It puts the harness in every Generate list.'),
})

// ── Skills (docs/managed-agents/skills.md § Skills) ───────────────────────────────────────────────
//
// A named procedure an agent loads when a task calls for it: a folder holding a `SKILL.md`, the shape
// Claude Code reads, with nothing added. The host reads and checks the file when it loads the package,
// because the rules are about bytes a parser of this file never sees.
export const skillDescriptor = z.object({
  // Namespaced by the host into `<pluginId>:<id>`, the name the agent and the settings page see.
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'skill id must be lower-case letters, digits and dashes')
    .describe("The skill's name, in lowercase letters, digits, and dashes. Agents see it as `<pluginId>:<id>`."),
  // The skill's folder, inside the package. Its `SKILL.md` and supporting files stay under it.
  path: entry.describe("The skill's folder in your package. It holds a `SKILL.md` and anything it uses."),
})
