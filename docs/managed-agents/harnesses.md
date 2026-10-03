# Harnesses

A harness is one agent acorn can manage, such as Claude Code or Codex. This page covers the two driver
tiers, how a plugin contributes a harness, the one-shot text mode, and what acorn declares to an ACP
agent. The drivers are in `plugins/agents/src/server/drivers/`.

A driver adapts a harness's protocol into the common session and event model. A profile says how to
launch the CLI, resume it, and run it headless. It's registered in a core registry that terminal,
agents, and workflows share. A profile can exist for terminal use with no managed driver behind it,
as `aider` does.

## Two driver tiers

**Tier 1 is the generic ACP driver, and a harness is data.** One driver, `acpDriver.ts`, runs from a
launch spec: a command or a package-relative adapter entry, arguments, an environment passthrough
list, and a few declared quirks (`HarnessQuirks` in `harness.ts`). The normalizer, event ledger,
transcript, and permission plumbing are shared. This is the path for a new agent and the only path a
loaded plugin can reach. Claude runs here.

**Tier 2 is a native driver, first-party only, for what ACP can't say.** Codex runs here, because its
app-server offers `thread/fork`, `thread/compact/start`, `thread/archive`, `thread/delete`, and
per-turn model, effort, permission, and collaboration-mode settings that ACP has no call for. The
registry's two doors name the difference: `register(spec)` takes data, and
`registerNative(id, factory)` takes code.

The ACP driver reads how to resume from the agent's `initialize` answer. `session/load` replays the
history the agent kept, and `session/resume` restores context and sends nothing back. Claude Code
offers the first and DeepSeek the second, so a harness declares neither. If the agent answers that it
doesn't know the reference, as after a moved checkout or a pruned store, the driver starts a fresh
session and warns in the transcript. The `sessionPersistence` quirk covers only the terminal handoff.

### Codex

The native driver lists Default and Plan through `collaborationMode/list`, expands the chosen preset
for `turn/start`, and follows `thread/settings/updated` so the model and effort acorn shows stay in
step. An app-server without the list endpoint runs with no Mode picker.

Codex's `turn/plan/updated` steps draw as a progress card. A completed `plan` item is stored as a
proposal and shown in the transcript. For the latest completed interactive Plan turn, the card offers
**Implement plan**. The Node checks the proposal and turn in one transaction, switches the Mode option
to Default, and queues one continuation in the same thread. The turn records the proposal, so a
second click reuses it. A revision turn or a rejected handoff leaves Plan selected.

Generated files cross a provider-neutral seam. A driver emits bytes with a title, media type, and
artifact kind. The runtime bounds them, stores them in the content-addressed artifact store, and
writes only the artifact reference to the ledger. Codex opts in with `generated_artifacts` and maps
`imageGeneration` items to it.

### What a built-in adapter is told

A built-in spec's `acpSessionMeta` is a function of the session, sent on create and on every resume,
so it returns the same value each time. Claude's turns off Claude Code's own continue-after-usage-limit
([operations](./operations.md#plan-usage-limits)). For a workflow or delegated session it appends the
turn-ending instruction to the system prompt
([workflow execution](../workflows/agent-steps.md#a-turn-that-ends-early)). The instruction goes in at
creation, because a system prompt that changes mid-session invalidates the model's earlier thinking.

Both drivers send a context part as an `<acorn-context>` block (`contextBlock.ts`). The label and
source are escaped, and a closing tag inside the content is broken, so a plugin label or a pull
request body can't end the block early and pass as your message.

## Contributed harnesses

A manifest's `harnesses` entries reach the Node like schedules do. The composition root carries them
on the loaded-plugin binding. `packages/node-core/src/server/pluginHost/host.ts` resolves each adapter
entry inside the package and turns each probe route into a call. It hands the result to the host-only
`harnesses` facet of `HostPluginContext`, so a plugin has no member to call. The facet forwards to
the `agents.harnessRegistry` capability, resolved at delivery and not cached. With agents disabled the
entries do nothing, and re-enabling delivers them again. A package with no Node bundle still gets a
plugin row (`contributesNodeData` in `manifest.ts`), so you can turn it off in **Settings > Plugins >
Installed**.

plugins/agents owns the child process, the session, and the transcript. The contributing plugin only
describes the spawn, so a data-only harness plugin needs no `exec` grant.

A harness names a program acorn runs, so the trust prompt lists it under **Enforced**. The spawn and
the environment passthrough are the grant key, so a version that swaps the binary, changes arguments,
or widens the globs asks again. A one-shot mode is a second invocation with its own line and key.

**IDs are persisted.** A harness ID is a session row's `providerId`, a profile ID is its `profileId`,
and a workflow step stores `profile`. Renaming one breaks every stored row. The built-in IDs
`claude`, `codex`, and `claude-code` are bare names. The host namespaces a loaded plugin's harness ID
as `<pluginId>:<harnessId>`. [Plugin authoring](../plugin-authoring.md) has the authoring contract.

## Headless and one-shot modes

A headless turn runs in `auto`, and a one-shot text turn in `dontAsk`. `dontAsk` denies anything not
in a `permissions.allow` rule, and acorn writes no such rules, so a headless step would see every tool
and be denied each call. `auto` approves through a classifier. The Node still decides what an agent
can reach, from the owner's tier and tool preferences narrowed by the step's ceiling. `aiArgv` keeps
`dontAsk` because it passes `--tools ''`.

`aiArgv` is the one-shot text mode, and declaring it is the opt-in. A profile with it can answer one
prompt with tools off, which makes it a profile a workflow `decide` step can name and a backend every
Generate control lists beside your API keys ([model providers](../integrations/model-providers.md)).
Claude Code and Codex declare it. Aider and the shell profile don't.

A manifest's `oneShot` block sits beside `terminal`, so a harness with no interactive CLI still
reaches Generate. DeepSeek is that case: `dsh --profile headless` answers and exits. Its profile row
carries `interactive: false`, which keeps it out of the terminal's profile menu. A harness declares
`oneShot.command` or `terminal`, not both, because "is it installed" is one lookup on `PATH`.

The system text arrives as `HeadlessOpts.system`, and the profile decides how to send it. Claude Code
passes `--system-prompt`, which replaces the coding persona. Codex prepends it to the prompt. A profile
can also declare `models`, `defaultModelId`, `listModels`, and `glyph`. Claude Code lists the aliases
`sonnet`, `opus`, `fable`, and `haiku`. Codex reads its models from the local app-server's
`model/list`. Both offer **Use CLI default**, which omits the model flag.

Each profile names its own stream adapter in
`packages/node-core/src/server/agentProfiles/streamJson.ts`. Claude Code writes a `result` event with
the answer, cost, and tokens. Codex writes the answer in the last `agent_message` item, the resume
reference on `thread.started`, and tokens on `turn.completed`. Codex reports no cost, so none is
invented. With `--output-schema`, the adapter parses the message as JSON only when it reads as an
object or array.

## What the ACP driver declares

A contributed harness reaches acorn's own tools through the protocol: the driver names acorn's MCP
server on `session/new` and on resume, for any harness with no `mcp add` command. Claude Code and Codex
keep their config-file registration. Your servers from Settings → MCP servers reach every harness
through the protocol ([MCP configuration](../mcp.md#configuration)).

The driver declines `fs`, `terminal`, and the `mcpServers` client capability at `initialize`. Each
would be worth adopting on its own: `fs` would route file reads and writes through acorn, `terminal`
would run agent commands in acorn's process lifecycle, and `mcpServers` would let an agent hand acorn
a server to proxy, a separate consent question.

The driver declares `elicitation.form`. Without it, Claude Code's adapter disallows its own
`AskUserQuestion` tool and auto-declines MCP elicitations, so the agent guesses instead of asking.
URL-mode elicitation stays undeclared. `formElicitation.ts` maps one schema property to one
question, with no vendor field names, so ACP and Codex forms map the same way. A Codex form with no
properties is consent, offered as Allow and Decline. An answer goes back as the option's own value,
because Codex numbers its options by position. When `session/prompt` returns, the driver answers any
question still parked with `cancel` and records `request_resolved`, which releases the row.
[App-access approval](./app-access.md) covers the one consent form with more choices.
