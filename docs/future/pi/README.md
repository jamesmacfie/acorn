# What acorn takes from oh-my-pi

Status: proposed, 2026-10-02; sequential phases added 2026-10-03; harness bridges and the Mods
directory survey added 2026-10-07. On 2026-10-07 the separate design topics and the `phases/` folder
were merged, so each numbered file here now holds one phase's design and its handoff. All eleven
phases finished on 2026-10-07. Phases 01 to 07, 09, and 10 are done with recorded limitations, phase
08 ended by removing the experiment, and [phase 11](./11-programme-acceptance.md) holds the combined
acceptance record and the checks still owed. Where a file here disagrees with a shipped contract, the
owning reference document wins until the implementation changes that contract.

Give a developer one phase at a time and require its acceptance record before continuing. Each
phase file holds the design behind it, the implementation steps, and the acceptance gate. The phase
plan incorporates the permission design from [mods.md](../mods.md) and resolves consumer,
review-reader, and unattended operation prerequisites.

## What this is

[oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) is a coding agent: a fork of Mario Zechner's
Pi with a large set of built-in tools and a TypeScript extension system. This programme records what
its extensions can do that an acorn plugin cannot, why, and the changes that close the gaps worth
closing.

The finding that shapes everything else is about the agent loop, not about how many plugin features
each side has. The loop is the cycle that builds a prompt, calls the model, runs the tools it asks
for, and feeds the results back. `omp` owns its loop, so an extension sits inside it. Acorn drives
loops other people wrote: Claude Code over ACP, Codex over its app-server, and DeepSeek and any
contributed harness over ACP. An acorn plugin sits outside the loop and reaches only its edges.

That difference is structural. No amount of plugin API widening lets an acorn plugin rewrite what
Claude Code sends to Anthropic, because that happens in Claude Code's process. So the programme does
three things: it widens the edges acorn does own, it tests whether acorn needs a loop of its own at
all by running `omp` as a harness first, and it reaches inside each harness's loop through that
harness's own hook system ([phase 10](./10-harness-bridges.md)). Claude Code, Codex, and `omp` each
publish one, so a plugin can write against acorn's points once.

## What `omp` extensions can do

An `omp` extension is a TypeScript module with a default factory that receives an `ExtensionAPI`
(`coding-agent/src/extensibility/extensions/types.ts` under `packages/` in the `omp` repository). It loads
in-process with no isolation, and `ctx.isProjectTrusted()` always returns `true`. From that position
it can:

- Rewrite the message list before every model request (`context`), replace the raw provider request
  (`before_provider_request`), and rewrite a finished assistant message before it is stored
  (`assistant_message`).
- Block, rewrite, or annotate any tool call, including the built-in `bash` and `edit` (`tool_call`),
  patch a tool's result (`tool_result`), and replace a built-in tool while still calling the original
  through `ctx.invokeTool`.
- Stop the model's reply mid-stream when a rule matches, inject the rule, and retry from the same
  point. `omp` calls this time-traveling stream rules (TTSR).
- Ask a side question over the live conversation without adding to it (`ctx.runEphemeralTurn`), and
  pick a model by family (`ctx.models`). The advisor feature, a second model that reviews every turn
  and injects notes, is built from these.
- Push a message into a running session with a delivery mode: steer the current run, follow up after
  it, aside at the next step, or hold for the next turn (`pi.sendMessage`).
- Register model providers, slash commands, keyboard shortcuts, and terminal renderers for tool calls.
- Ship skills, rules, prompts, subagent definitions, MCP servers, and language-server and debugger
  setups as one plugin, in a format compatible with Claude Code's plugin marketplace.

## What an acorn plugin can reach

A loaded acorn plugin runs in a permission-scoped worker and reaches the agent through these seams:

- `agents:before-send`, which can observe, transform, or veto a prompt before acorn sends it.
- Context sections and agent contexts, which add bounded text to what a session starts with.
- Agent tools, which reach every harness through acorn's MCP server.
- `core:before-tool-call`, which guards acorn's own tools only.
- Lifecycle events on `plugin:agents:turn-changed`, `request-changed`, and `sessions-changed`.
- `agents.reviewInput.v1`, a bounded completed-turn reader, delivered in phase 04
  ([review input](../../managed-agents/session-events.md#review-input)).
- `agents:turn-follow-up`, a bounded review window a workflow step or a delegated turn opens before
  its owner reports, and notes that join that owner's operation, delivered in phase 05
  ([unattended follow-ups](../../managed-agents/unattended-follow-ups.md)).
- `ctx.core.models.generateText` under the `models` grant, which spends a backend the caller names,
  or with no backend the owner's model grant for that plugin, delivered in phase 04.
- `agents:before-permission`, a veto on the permission requests every harness sends, delivered in
  phase 02 ([permission policy](../../managed-agents/permission-policy.md)).
- `agents:session-messenger`, an attributed and capped note on a session, delivered in phase 03
  ([session messages](../../managed-agents/session-messages.md)).
- `contributions.skills`, named procedures approved on the Node, delivered natively to Claude Code and
  Codex and as an index to other harnesses, delivered in phases 06 and 07
  ([skills](../../managed-agents/skills.md)).
- `plugin:agents:activity`, `agents.activity.v1`, `agents.sessionControl.setConfig`, and the
  `agents:request-card` point, delivered in phase 09
  ([session control](../../managed-agents/session-control.md)).
- `agents:before-tool` and `agents:after-tool`, run inside Claude Code's loop through a command hook
  acorn installs, delivered in phase 10 ([harness bridges](../../managed-agents/loop-hooks.md)).
  Codex, DeepSeek, and `omp` have no bridge.
- UI points such as `agents:tool-card`, `agents:session-header`, and `agents:composer-actions`.
- Custom agents, MCP servers, and harness contributions.

That list is long, and the workspace side of the plugin system (panes, rail sources, dashboards, data
sources, trees, cooperative hooks) has no equivalent in `omp` at all. The gap is narrow and deep:
everything inside the loop.

## The phases

| Phase | Handoff | Result required before the next phase | Outcome, 2026-10-07 |
| --- | --- | --- | --- |
| 01 | [Contributed omp harness](./01-omp-harness.md) | A tested loaded harness, or a recorded unsupported capability with a bounded driver fix. | Done with limitations: works as a loaded harness; no real-host card, provider not signed in. |
| 02 | [Permission veto and policy plugin](./02-permission-veto.md) | Permission refusals work through a real loaded plugin, with resolved cards on both hosts. | Done with limitations: shipped; Codex, DeepSeek, and `omp` not run. |
| 03 | [Attributed session messages](./03-session-messages.md) | Interactive sessions accept bounded, attributed notes; the policy plugin explains its refusals. | Done with limitations: shipped; Codex not run. |
| 04 | [Model grants and interactive advisor](./04-model-grants-and-advisor.md) | A real advisor proves host-held model choices, accounting, and a bounded completed-turn reader. | Done with limitations: shipped; agent CLI backends only. |
| 05 | [Unattended follow-ups](./05-unattended-follow-ups.md) | Workflow and delegation owners account for and cancel plugin follow-ups before unattended delivery is enabled. | Done with limitations: shipped; the advisor correction was shown in phase 11; no delegated run. |
| 06 | [Portable plugin skills](./06-portable-skills.md) | A skills-only plugin delivers a validated, readable index on start and resume. | Done with limitations: shipped; Claude on the real host. |
| 07 | [Native skill delivery](./07-native-skills.md) | Claude uses native skills; Codex uses a verified native door or the documented portable fallback. | Done with limitations: Claude and Codex native on the real host; others keep the index. |
| 08 | [Resource-read experiment](./08-resource-read-experiment.md) | Paired results justify retaining the experiment, or its implementation is removed. | Removed: both harnesses failed the stop rule; no product code shipped. |
| 09 | [Activity feed, session options, and request notes](./09-session-reach.md) | A loaded meter reads activity on every harness and changes options; the policy plugin notes risky requests. | Done with limitations: Claude and Codex on the real host. |
| 10 | [Harness bridges](./10-harness-bridges.md) | Bridged harnesses run acorn's hooks on every tool call; Codex has a bridge or an evidenced limitation. | Done with limitations: Claude only; Codex refuses an untrusted hook. |
| 11 | [Programme acceptance](./11-programme-acceptance.md) | Combined real-host evidence, published owning contracts, and a recorded disposition for every phase. | Done with limitations: combined real-host flow, published agents types; Node switching and a Codex refusal still open. |

[refused.md](./refused.md) records what this programme decided not to take from `omp`, and why.

Each phase assumes the previous phase's accepted handoff, even where the underlying feature could
be implemented independently. Phase 01 may finish with an evidenced harness limitation rather than
blocking all harness-neutral work. Phase 08 may finish by deleting the experiment. Neither outcome
licenses silently omitting verification.

## The order of work

Phase 01 tests whether `omp` provides the deep-loop features without Acorn building another agent
loop. The harness-neutral features remain useful for Claude, Codex, and DeepSeek regardless of that
outcome.

Phase 02 delivers the permission hook with a real policy plugin. Phase 03 delivers interactive
messaging with that plugin's optional explanations. Phase 04 delivers model grants, a replacement
review reader, and the interactive advisor together. Phase 05 integrates unattended operation
lifetime, cancellation, and accounting before enabling automatic workflow/delegation notes.

Phases 06 and 07 deliver portable and native skills in order. Phase 08 measures resource reads and
may remove the experiment. Phase 09 gives plugins the activity feed, option changes, and request
notes. Phase 10 installs harness bridges. Phase 11 accepts the combined programme on real clients
and a headless Node.

The rule in [extensibility.md § Unexercised seams rot](../../extensibility.md#unexercised-seams-rot)
applies throughout: each public seam lands with its loaded consumer and evidence across the worker
boundary.

## Decisions that reconcile the designs

- Keep the permission hook veto-only. A timeout passes the request to the person. Explanation is a
  separate messaging grant, delivered in phase 03; it is optional in the policy plugin's settings.
- Add a canonical provider request ID to the hook payload. The consumer needs it to distinguish
  retries from separate permission requests when assigning explanation idempotency keys.
- Explain only committed vetoes, using resolved lifecycle notifications and a bounded blocked
  projection. A handler's late or superseded verdict must not produce a false explanation.
- Ship messaging with the policy consumer. Ship model grants with the advisor. A fake driver is
  useful evidence, but does not replace a loaded consumer crossing the worker boundary.
- Introduce a bounded review reader in phase 04. Findings was deleted, and
  `agents.reviewInput.v1` is absent from the agents lifecycle contract inspected on 2026-10-03.
  Do not restore Findings or assume its reader still ships.
- Restrict automatic messages to interactive sessions through phase 04. Phase 05 owns unattended
  operation lifetime, accounting, and completion. `controller: 'acorn'` alone is insufficient.
- Preserve explicit-backend generation calls. The omitted-backend path uses the host grant and its
  cap. That cap does not bound all calls a plugin with the broad `models` permission can make.
  Explain this distinction in settings and the owning contract.
- Deliver skills as named procedures. Always-on instructions remain context sections. Native
  delivery is per harness, and an unavailable native door uses the portable delivery result.
- Give the permission hook's subject a named public type. Phase 10's `agents:before-tool` reuses it,
  so one policy handler covers asked questions and bridged calls.
- Bridges install through each harness's own hooks and never return allow. They are acorn's
  answer to in-loop extension; acorn still builds no loop of its own.
- Treat resource reads as a measured experiment. Keep writes and search as tools, preserve task
  authorization, and require the original 15% context saving without losing completed tasks.

## Shared architecture and review rules

The Node owns policy decisions, queues, grants, accounting, skill catalogues, and orchestration.
The agents plugin owns session contracts and lifecycle. Core owns model credentials, generic plugin
loading, trust, and MCP transport. Plugins consume these owners through public contracts and declared
contributions; they do not import their implementations or read their databases.

Trace every client change through its Node route, public wire type, broker, selected-Node query
cache, and shared UI consumer. Use additive wire changes and migrations rather than resets. Put
domain logic in feature-owned modules; keep activation entrypoints and runtime coordinators thin.

Use standalone policy, advisor, and skills packages as real consumers. Their source must accompany
the handoff in a durable repository or supplied archive, with an exact revision and install/build
instructions. Do not make the next developer reconstruct them from an absolute local folder. Small
test fixtures can live beside the owning tests; production consumers remain loaded packages. The
packages built so far are in [`packages/`](./packages/).

## Verification for every phase

Run `pnpm lint` and focused tests for the changed owners. Typical commands are:

```sh
pnpm --filter @acorn/plugin-agents test
pnpm --filter @acorn/node-core test
pnpm --filter @acorn/arch-tests test
```

Recheck package scripts before running a command. For the full suite use `pnpm test`, which bounds
process concurrency. Run the architecture and documentation tests when contracts or docs change.
Exercise the Node without a desktop when changing Node ownership or loaded-plugin transport.

For desktop changes, run the real Tauri window with
`pnpm dev:agent -- --session pi-phase-NN`, then the `dev:agent:ui` driver. Take a fresh snapshot after
each transition, inspect screenshots, and stop the driver. For terminal changes, use
`pnpm dev:tui:agent -- --session pi-phase-NN-tui --fixture tui-navigation`, the PTY driver, and both
the default size and `resize 120 40`. Follow [local development](../../local-development.md)
for complete commands. Do not label graphical acceptance passed without these checks.

Tests must prove behavior at a boundary: permission resolution, persisted state, worker transport,
authorization, concurrent admission, lifecycle, or visible output. Avoid tests that restate a helper.

## The handoff record

At the end of each phase, update its status with an absolute date and record:

- The implementation revision, changed contracts, migrations, and consumer package revisions.
- The commands run and results, plus links to real-host reports and inspected screenshots.
- Provider versions and protocol evidence for any harness-specific claim.
- Any limitation, its effect on subsequent phases, and the accepted fallback.
- The owning docs updated and the exact next phase to begin.

Retained future files describe decisions and evidence. Shipped behavior belongs in the owning
reference docs. Never report a phase complete with an unresolved acceptance gate.

## Relation to other programmes

- [mods.md](../mods.md) owns the base permission design. Phase 02 delivers the hook and phase 03 the
  explanation consumer.
- The shipped [memory contract](../../notes-and-memory.md#memory) replaces Findings, which consumed
  `agents.reviewInput.v1` and supplied the precedent phase 04 generalizes. The Findings removal also
  removed that capability. Phase 04 introduced its bounded replacement with the advisor.
- [Security](../../security.md) owns the shipped containment boundaries. Nothing here is containment,
  and phase 02 says so.
- [ecosystem/](../ecosystem/README.md) owns discovery and signing. Phase 06 touches the Claude Code
  marketplace format and defers to ecosystem on discovery.

## Correction to the first comparison

The conversation that started this programme said loaded plugins cannot spend model keys. That was
wrong. A loaded node plugin with `permissions.node.core: ["models"]` calls
`ctx.core.models.generateText` and spends whichever backend it names
([the manifest § Permissions](../../plugin-authoring/permissions.md#permissions)). What a loaded
plugin cannot do is spend a provider credential from inside an agent tool handler, which runs as a
task principal. Phase 04 is written against the corrected picture.

## Verify before building

Each phase ends with its own list. Across all of them, re-read
[architecture](../../architecture-overview.md), [conventions](../../conventions.md),
[plugin map](../../plugin-map.md), [managed agents](../../managed-agents.md),
[agent tools](../../agent-tools.md), and [node extension points](../../plugins/node-side-extension-points.md).
Inspect the working tree and preserve unrelated work. Paths in each handoff are starting points,
not permission to assume the implementation has remained unchanged. The `omp` facts come from its
repository at the commit cloned on 2026-10-02, and that project changes daily.
