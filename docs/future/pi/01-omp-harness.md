# Phase 01: contributed omp harness

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry:
[shared execution rules](./README.md) read. Next: [phase 02](./02-permission-veto.md).

## Completion note, 2026-10-07

**What landed.** The harness package is
[`docs/future/pi/packages/omp-harness/acorn-plugin.json`](./packages/omp-harness/acorn-plugin.json),
at the commit titled "Phase 01: Contributed omp harness" on branch `phase-01-omp-harness`. It's
manifest only: runtime ID `omp:omp`, `spawn` `omp acp`, `envPassthrough: ["OMP_*"]`,
`sessionPersistence: false`, no `oneShot`, `baseline: acorn-1` and `apiVersion: 3` from the scaffold,
and a pi glyph as its icon. To install it, put `omp` on the Node's `PATH` and post
`{ "source": { "path": "<checkout>/docs/future/pi/packages/omp-harness" } }` to
`POST /v1/core/plugins/install`, or use **Settings > Plugins > Install…**, then restart the Node.

Three admission and protocol fixes came out of the run. Each is generic and has its own test:

- **Workflow admission.** A workflow step on a contributed harness ran headless and failed, because
  `managedProviderForProfile` was a hard-coded `claude-code`/`codex` map. A profile now names its
  driver in `AgentProfileContribution.managedProvider`. The Claude and Codex profiles set it, and
  `harnessRegistry.ts` sets it to the harness's runtime ID. The workflow validator reads a
  `managedProfiles` set from its catalog instead of a global. Workflows has no `omp` case. Built-in
  behavior and the headless fallback for a profile with no driver are unchanged. Tests:
  `sessionExecute.test.ts` (a contributed profile runs as a managed session, and a profile with no
  driver answers `null`) and `definition.test.ts` (map-step admission).
- **Workflow publication.** The publication service took `runner.validationCatalog()` once, when
  workflows activated, before loaded plugins registered their harnesses. Publishing a step on
  `omp:omp` failed with "names unknown profile". `catalog` is now a method the service calls each time.
- **Turn failure text.** The ACP SDK turns any error an agent throws into `-32603 Internal error`
  and puts the agent's message in `data.details`. The driver showed only "Internal error". It now
  shows the details. Fixture: `__fixtures__/failingAcpAgent.mjs`, tested in `acpDriver.test.ts`.

Docs updated: [harness authoring](../../plugin-authoring/harnesses.md#harnesses) (an `omp` example,
and workflow steps on data-only harnesses), [managed-agents harnesses](../../managed-agents/harnesses.md)
(`managedProvider`, resume choice, and the `omp` error code), [subagents](../../managed-agents/subagents.md),
[workflow agent steps](../../workflows/agent-steps.md), and manual check 155 in
[agents and providers](../../testing/agents-and-providers.md). No migration and no wire change.

**Provider and evidence.** `omp` 18.7.0, the `omp-darwin-arm64` release asset, SHA-256
`1715813a16ad2925a915ef4f8a55a5b82b61759ebcb3768295e8ab26d549d834`. Nobody was signed in to a cloud
provider, so every model turn used `omp`'s keyless Apple on-device model, Apple AFM 3 Core, which has
a 4,096-token window. Evidence comes from three sources:

- A stdio probe that speaks ACP to `omp acp` with Acorn's exact `initialize` capabilities, run with
  `PATH=/usr/bin:/bin`, so no Bun.
- A real desktop session, `pnpm dev:agent -- --session pi-phase-01`, launched with the binary on
  `PATH` and `OMP_PROFILE=acorn-phase-01`. That profile turns off most of `omp`'s features to save
  tokens, and sets `modelRoles.default: apple/on-device` and `disabledProviders` for other agents'
  config imports. The installed copy added `--tools bash,read,edit,write,ask --no-lsp --no-skills
  --no-rules --no-title` before `acp` to save more. The committed manifest keeps `["acp"]`.
- Screenshots `01-session-start.png` and `04-omp-terminal.png` in that session's ignored
  `.acorn/agent-dev/pi-phase-01/screenshots/`.

**Capability matrix for `omp` 18.7.0.** Later phases use this for the `omp` cases.

| Capability | Result | Evidence |
| --- | --- | --- |
| Install, Node restart | Works with no Node or client bundle. `omp:omp` lists as installed, with its executable found on `PATH`. | Desktop |
| `initialize` | `loadSession`, `sessionCapabilities` `resume`, `fork`, `close`, and `list`, MCP `http` and `sse`, prompt `image` and `embeddedContext`. One auth method, `agent`, "existing local credentials". The driver ignores auth methods and that's harmless. The Agent Center shows auth as unknown, because there's no auth probe. | Probe |
| Config options | **Mode** (Default, Plan), **Model**, and **Thinking** render in the pane. | Desktop |
| Model choice | A fresh profile answers "No model selected" until a model is set by `session/set_config_option` or `modelRoles.default`. Picking the value already shown in the pane doesn't send a change, so set the profile default. | Probe, desktop |
| Transcript | Streaming text, usage (`6,391 / 4,096 context`), and `end_turn` render. A provider failure such as an over-long prompt arrives as ordinary assistant text ending in `end_turn`, so a workflow step reads it as success. | Desktop |
| Native `write`, `read` | Creating a file asks no permission. Files are written with `omp`'s own tools, not Acorn's file callbacks. | Probe |
| Permission | `bash` sends `session/request_permission` with `allow_once`, `allow_always`, `reject_once`, and `reject_always`. Allow runs the command. Reject comes back as a failed call: "Tool call rejected by user (bash)". `tools.approvalMode` defaults to `yolo` in `omp`'s config, yet ACP mode still asked. | Probe |
| Forms | `ask` sends `elicitation/create`, mode `form`: a `oneOf` field plus a free-text `<id>__other` field. Acorn's normalizer turns it into a choice question and an optional text question, and returns the chosen value. | Probe, normalizer run |
| Resume | The driver picks `session/resume`. History survives an `omp` process restart in the probe. After an Acorn restart, the session reconnected with no fresh-start warning. An unknown reference answers `-32603`, not `-32002`, so the driver doesn't start fresh. That session fails to start instead. | Probe, desktop |
| Delegation | A Claude Code parent's `agent_spawn` with `profileId: "omp:omp"` ran a managed child and delivered its report. No code change was needed. | Desktop |
| Workflow agent step | Publishes, runs as a managed `workflow` session on `omp:omp`, and the run finishes. This needed the two workflow fixes above. | Desktop |
| Terminal profile | **oh-my-pi** appears in the task terminal menu and opens `omp`'s own sign-in setup. Continuation isn't claimed, and `sessionPersistence` stays `false`. | Desktop |
| Subagents | ACP mode sends no subagent metadata. `task` subagents can only appear as ordinary tool calls, and the roster stays empty. | Static, from the binary |
| Nested worktrees | `task.isolation.enabled` defaults to `false`, so `omp` creates none. Where it puts them when an owner turns it on, and whether archive cleans them, wasn't checked. Keep it off. | Config |
| Stdout | Every probe run carried only JSON-RPC lines on stdout. No extension was loaded. | Probe |
| `OMP_*` passthrough | `OMP_PROFILE` reaches `omp` and isolates its store. Most of `omp`'s environment settings are `PI_*` and don't pass through. `OMP_AUTH_BROKER_TOKEN` is a credential that `OMP_*` would carry if the Node's environment held it. | Desktop, binary strings |

**Limitations.** Each has the evidence above.

- The in-app permission card and question card were not answered against `omp`. With Acorn's tool
  server and task context attached, `omp`'s prompt was 7,800 to 8,300 tokens, and a delegated child's
  was 4,543, all over the on-device model's 4,096. The tool server can't be removed from a session.
  The same requests were answered at the protocol level, and Acorn's generic permission and form
  paths are unchanged. Repeat check 155 with a signed-in provider.
- Step 5 wasn't run: one extension or stream rule plus the advisor. Both need a model that can hold
  a real prompt. The verified door is a config overlay, `omp --config <file>`, or the profile's
  `config.yml` selected by `OMP_PROFILE`. `ttsr.enabled` and `ttsr.builtinRules` default to `true`,
  so stream rules are already on. `advisor.enabled` defaults to `false`. A second harness entry
  whose `args` are `["--config", "<path>", "acp"]` is the way to offer an advisor variant.
- The terminal client wasn't driven. It starts its own Node, and nothing in this phase changed client
  code. The desktop exercised the shared session surfaces.
- Two generic display gaps, out of scope: a data-only package's `icon` doesn't reach the Agent pane
  header, which draws the label's first letter, and the session list shows every harness's raw
  `providerId`.
- An `omp` session whose stored reference `omp` no longer has fails to start, because of the
  `-32603` answer. Recovering on that code would also catch real internal errors, so the driver is
  unchanged. Report it to `omp`.

**Commands run.** All passed: `pnpm test:focus` on each changed test file,
`pnpm test --filter=@acorn/plugin-agents` (150 files, 1,107 tests), `pnpm test --filter=@acorn/plugin-workflows`
(64 files), `tsc --noEmit` in `packages/node-core`, `pnpm lint`, and `pnpm --filter @acorn/arch-tests test`
(12 files). `apps/node` integration tests and the full `pnpm test` weren't run.

**For later phases.** Phase 02 can include `omp` in its harness roster. Its permission requests are
standard ACP and use stable option IDs. Validate it with a signed-in provider, because the on-device
model can't fit a real Acorn session. A workflow or delegated step on any contributed harness runs as
a managed session, so phase 05's unattended operation applies to `omp` too. Phase 05 must also account
for `omp` reporting provider failures as successful turns.

## Outcome

An owner can select `omp` as a loaded ACP harness and use Acorn's session, permissions, worktree,
and transcript surfaces. This phase establishes which deep agent-loop features can remain in `omp`
instead of becoming Acorn features.

## Design

The design as proposed on 2026-10-02. Where it differs from the completion note above, the completion
note records what was built.

### Why first

Every gap in this programme's [README](./README.md) comes from one fact: the agent loop belongs to
the harness, not to acorn. `omp` is a harness whose loop is extensible all the way down, and it
speaks the Agent Client Protocol (ACP) through `omp acp`. Acorn's tier 1 driver takes any ACP agent
from a manifest alone ([managed-agents.md § Harnesses](../../managed-agents/harnesses.md#harnesses)).

So the cheapest way to give acorn users context rewriting, stream rules, tool shadowing, and a
reviewer model is to let them run an agent that already has those, inside acorn's sessions,
transcript, permissions, worktrees, and delegation. If that works, acorn never has to build a loop to
offer deep-loop extensibility. If it fails, the failure says exactly which part of the generic driver
or the ACP contract is too narrow, which is worth knowing before building anything in the later phases.

It is also the second harness contributed from outside the repository after the Kimi proposal
([kimi.md](../kimi.md)), and the first whose agent advertises fork, close, and session listing as well
as load and resume.

### What `omp acp` advertises

From `coding-agent/src/modes/acp/acp-agent.ts` in the `omp` repository, at `initialize`:

| Capability | Value | What acorn does with it |
| --- | --- | --- |
| `loadSession` | `true` | The driver picks a session back up with `session/load`, which replays history. |
| `sessionCapabilities.resume` | present | The driver prefers `session/resume` when both are present. Check which one it picks. |
| `sessionCapabilities.fork`, `close`, `list` | present | The generic driver does not use them. Fork stays a Codex-only native feature. |
| `mcpCapabilities` | `http`, `sse` | Stdio is the ACP baseline, so acorn's stdio MCP server and the owner's servers reach it through `mcpServers`. |
| `promptCapabilities` | `image`, `embeddedContext` | Attachments and `<acorn-context>` blocks both work. |
| `configOptions` | built per session | Model, thinking level, and mode appear in the pane and become new-session defaults with no work. |
| `authMethods` | present | Check how the generic driver treats them; `omp` keeps OAuth logins in its own store. |

Acorn's ACP client advertises `fs.readTextFile: false`, `fs.writeTextFile: false`, and
`terminal: false` (`plugins/agents/src/server/drivers/acpDriver.ts`), so `omp` runs its own native
`read`, `edit`, and `bash` rather than routing them through acorn. That is the right answer: those
tools are the reason to pick `omp`.

Acorn does advertise `elicitation.form`, and `omp` bridges its `ask` tool and its extensions' dialogs
to `unstable_createElicitation` when a client offers forms. So `omp`'s structured questions should
reach the person as acorn's form card. Confirm that in step 2.

### The manifest

```json
{
  "$schema": "https://acorn.sh/schemas/acorn-plugin.schema.json",
  "id": "omp",
  "name": "oh-my-pi",
  "version": "0.1.0",
  "baseline": "acorn-1",
  "apiVersion": "3",
  "icon": { "d": "PLACEHOLDER_24x24_PATH_D" },
  "contributions": {
    "harnesses": [
      {
        "id": "omp",
        "label": "oh-my-pi",
        "spawn": { "command": "omp", "args": ["acp"] },
        "envPassthrough": ["OMP_*"],
        "quirks": { "sessionPersistence": false },
        "terminal": { "command": "omp" }
      }
    ]
  }
}
```

The runtime id is `omp:omp`. It is persisted into session rows and workflow steps, so choose it once.
Copy `apiVersion` and `baseline` from the scaffold at the time of building rather than from here.

#### Credentials stay in `omp`'s own store

`omp` signs in with `/login` and keeps OAuth tokens and keys under `~/.omp/agent`. Keep
`envPassthrough` to `OMP_*` and let the person run `omp` once in a terminal to sign in. Passing
`ANTHROPIC_API_KEY` or similar through would put a provider credential on a trust line for no gain,
and the whole spawn plus the passthrough list is the grant key, so widening it later asks again.

#### Start `sessionPersistence` at `false`

The same reasoning as [kimi.md § Start `sessionPersistence` at `false`](../kimi.md#start-sessionpersistence-at-false).
The quirk only controls the terminal handoff. Turn it on after a manual check shows that
**Continue in terminal** reopens the same conversation in `omp`.

#### Leave `oneShot` out

Acorn's contained generate turns tools off and runs in an empty directory. `omp -p` loads extensions
and tools by default, and this programme has not found the flag set that turns all of them off. Add
`oneShot` only after someone confirms the arguments that give a tool-free, extension-free, plain-text
answer. Until then `omp` works in the Agent pane and a task terminal.

#### Approval mode

`omp acp` sends ACP `session/request_permission` for `bash`, deletes, moves, and edits that delete
or rename. Plain content edits do not ask. That matches how acorn already treats Claude in its
accept-edits mode. Do not pass `--yolo` or `--auto-approve` in `args`: that would skip acorn's
permission card entirely and the manifest would read as a quiet grant.

### What the owner gets inside `omp`

Everything `omp` loads from its own configuration runs inside an acorn session:

- Extensions from `~/.omp/agent/extensions` and the worktree's `.omp/extensions`.
- Rules, including TTSR rules, from `.omp`, `.cursor`, `.claude`, and the other formats `omp` reads.
- The advisor, when the person enables it. ACP and RPC hosts get protocol defaults for `advisor.*`,
  so it starts off unless a config overlay turns it on. A second harness entry with
  `"args": ["acp", "--config", "<path>"]` is the way to offer an advisor variant, and that path has
  to come from a `files` grant, not a literal.
- Memory, if the person configured an `omp` memory backend. This is separate from acorn's memory and
  the two do not share anything.

Acorn sees all of this only as ACP traffic. A TTSR interruption, for example, arrives as an aborted
turn followed by a new one, and the transcript draws it that way.

### Risks to check

- **Nested worktrees.** `omp`'s `task` tool can fan out into isolated workspaces using APFS clones or
  copies. Inside an acorn worktree that creates a second layer acorn does not track. Check where
  `omp` puts them and whether archiving the acorn task cleans them up. If not, document the setting
  that turns isolation off.
- **Subagent reporting.** `omp` subagents are not ACP sessions. Acorn's provider-native subagent
  roster ([managed-agents.md § Provider-native subagents](../../managed-agents.md#provider-native-subagents))
  shows what each harness reports, and `omp` may report nothing. That is acceptable; record it.
- **Runtime.** `omp` ships as a compiled binary through Homebrew and its install script. Confirm
  `omp acp` starts with no Bun on `PATH`, because the node service's login-shell `PATH` is what the
  spawn sees.
- **Stdout noise.** `omp` detours extension `console.log` away from stdout in ACP mode
  (`coding-agent/src/modes/acp/acp-mode.ts`). A user extension that writes to stdout some other way
  would corrupt the stream. The driver's error for a malformed frame should name the harness.

### What this does not give acorn

`omp`'s extensions only run in `omp` sessions. A Claude or Codex session gets none of them. Acorn's
own plugins still see an `omp` session from outside, exactly like any other harness. That is why
the later phases still matter.

## Ownership and data flow

Installed manifest → core harness registry → agents provider/profile → generic ACP driver → `omp`
process. ACP updates become driver events, durable agents rows, lifecycle frames, broker query
invalidations, and the shared desktop/terminal session UI. OAuth credentials remain in `omp`'s store.

Start with these owners:

- `plugins/agents/src/server/drivers/acpDriver.ts` and `acpSession.ts`.
- `plugins/agents/src/server/drivers/harness.ts` and `registry.ts`.
- `plugins/agents/src/contract/sessionExecute.ts` and the managed execution implementation.
- [Harness manifest contract](../../plugin-authoring/harnesses.md#harnesses).

The checked execution contract maps built-in profile IDs through `managedProviderForProfile`.
Do not assume a contributed ACP profile also runs through workflow steps because it works in the
Agent pane. Inspect workflow admission and fallback behavior explicitly.

## Implementation

1. Pin an `omp` version and inspect its ACP initialization, help, authentication, permission mode,
   extension loading, and resume behavior. Record protocol evidence, including elicitation forms.
   Treat the 2026-10-02 comparison as research to verify, not an external API specification.
2. Create a standalone harness-only loaded package from the scaffold. Keep runtime ID `omp:omp`,
   `spawn.command: 'omp'`, `args: ['acp']`, and `envPassthrough: ['OMP_*']`. Copy baseline and API
   version from the scaffold. Supply a real icon. Keep `sessionPersistence: false` and omit `oneShot`.
3. Run an interactive session through prompt, edit, permission request, structured question, model
   selection, Node restart, and resume. Capture native `read`, `edit`, and `bash` behavior, rather than
   advertising Acorn filesystem or terminal callbacks that it does not implement.
4. Run a delegated session and a workflow agent step. If a built-in profile mapping excludes the
   contribution, resolve it through the public harness registry at the owning admission layer.
   Preserve existing built-in behavior and the absence-of-managed-driver fallback. Do not add an
   `omp` special case to workflows or widen plugin access to runtime internals.
5. Enable one `omp` extension or stream rule and its advisor using the verified configuration door.
   Record the ACP transcript representation. Check nested worktrees, task archive cleanup,
   provider-native subagent reporting, stdout contamination, and operation without Bun on `PATH`.
6. Keep protocol fixes bounded and separately reviewable. Fix a reusable generic-driver behavior,
   with a protocol fixture, rather than encoding unexplained manifest quirks. If a protocol feature
   cannot work, record the limitation and continue phase 02 with the supported harness roster.

Do not claim terminal continuation until it reopens the same conversation. Do not add broad provider
environment passthrough, auto-approval flags, a private agent loop, or a tool-enabled one-shot backend.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Add focused ACP or registry
coverage only for repository changes. Exercise real desktop and terminal sessions, not just a
successful manifest parse. Acceptance requires:

- The package installs and survives Node restart without a client or Node bundle.
- Allowed and rejected permission requests both return to the harness.
- Resume, forms, model choices, delegated execution, and workflow admission have recorded outcomes.
- Archive cleanup and extension-generated protocol traffic have an explicit disposition.
- Every unsupported capability has evidence and a visible limitation; none is silently claimed.

## Documentation and handoff

Update [harness authoring](../../plugin-authoring/harnesses.md#harnesses),
[managed agents](../../managed-agents.md), and
[agents/provider acceptance](../../testing/agents-and-providers.md) with verified behavior.
Record the standalone package revision and the provider capability matrix here. That matrix supplies
the `omp` cases for later phases; a blocked `omp` installation must not erase Claude/Codex acceptance.

## Verify before building

Check whether `omp` is installed and signed in, the manifest baseline, generic ACP authentication
handling, `session/load` versus `session/resume`, and contributed-profile execution admission.
Inspect the external project's supported flags and pin the exact tested version.

From the design:

- The harness manifest fields in [the manifest § Harnesses](../../plugin-authoring/harnesses.md#harnesses),
  especially whether `baseline` and `apiVersion` changed.
- How `acpDriver.ts` picks between `session/load` and `session/resume` when an agent offers both.
- How the generic driver handles `authMethods` in the `initialize` response.
- `omp acp --help` for the flags that set approval mode, config overlays, and tool isolation.
- Whether the install script's binary runs without Bun.
