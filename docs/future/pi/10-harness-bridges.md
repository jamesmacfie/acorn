# Phase 10: harness bridges

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-07. Entry: phase 09 accepted
with its loaded consumers. Next: [phase 11](./11-programme-acceptance.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-10-harness-bridges`, at the commit titled "Phase 10: Harness
bridges". [Harness bridges](../../managed-agents/loop-hooks.md) is the owning contract.

- **`ask`, a fourth hook mode** in `HOOK_MODES` (`@acorn/protocol/extensionPoints.ts`) and the
  plugin types. `runHook` runs an ask handler in the chain like a veto, records the first
  `{ ask: true, reason }`, and keeps going, so a later veto still refuses. The verdict gains
  `ask: { reason, by }` only when nothing vetoed. A timed-out ask asked nothing. Only
  `agents:before-tool` allows it. Trust copy: "Make a tool wait for you before agents can “run any
  tool”", marked high.
- **`ctx.hooks.handlers(id)`**, so an owner can ask which plugins handle one of its points. Async in
  `hostCallModes`, so a loaded owner can call it too.
- **`agents:before-tool` and `agents:after-tool`**, declared from `contract/loopHook.ts` with the
  payloads the design gives. The subject is phase 02's `AgentPermissionSubject` plus `toolName` and
  `title`. Both are install order, 5 s, `onTimeout: allow`.
- **The bridge program**, `loop-hook.js`, built beside `mcp.js` from `apps/node/src/entries/loop-hook.ts`
  and `packages/node-core/src/mcp/loopHook.ts`. It reads stdin, posts to the route its command line
  names, and prints the reply. Every failure prints nothing and exits zero. `acornLoopHook()` in
  `mcpRegister.ts` locates it beside the MCP entry.
- **The ingress**, `POST /v1/p/agents/loop-hook` (`server/routes/loopHook.ts`), and the
  `agents.loopHook.v1` request and reply types. Only a task token with a session gets an answer, and
  the token, not the body, names the session.
- **Claude Code's mapping** in `drivers/claudeLoopHook.ts`, tested from input recorded from Claude
  Code 2.1.292. **Installation** in `claudeHarness.ts`: command hooks merged into the flag settings
  acorn already sends, only for a point with a handler, read by the lifecycle at each start and resume.
- **`ask` end to end** (`server/sessions/loopHooks.ts`, loaded on first use): an ordinary permission
  request on the asking turn, detailed "`<plugin>` wants you to decide: `<reason>`", with **Allow**
  and **Reject**. `resolveRequest` answers a held ask before it looks for a driver handle. Reject is a
  deny, Allow is no decision, and no answer in 570 s expires the row and denies.
- **Coverage.** `loop_before_tool` and `loop_after_tool` in `AgentCapability`, reported by an ACP
  driver whose spec sets `loopHooks` and only where the Node has the bridge program. A core
  `core:plugin-page` remote point on the plugin page's **Permissions** tab, which agents fills with
  **Agents it reaches** from `GET /v1/p/agents/loop-coverage/:pluginId`.
- **Consumer.** [`packages/permission-policy/`](./packages/permission-policy/README.md) 0.5.0:
  `decide` as a veto and `warn` as an ask on `agents:before-tool`, and a hard-coded test-first guard
  on `agents:after-tool`.

No migration. `expirePendingRequests` takes an optional request id. Wire changes are additive: two
capabilities, a route, two hook points, a hook mode, a verdict field, a registry method, and a core
point. The manifest schema and the published surface pin were regenerated. Docs updated:
[hooks](../../plugins/hooks.md), [node extension points](../../plugins/node-side-extension-points.md),
[managed agents](../../managed-agents.md), [permission policy](../../managed-agents/permission-policy.md),
[MCP](../../mcp.md), [security](../../security.md), [remote points](../../plugins/remote-points.md),
[extensions](../../plugin-authoring/extensions.md), [mods.md](https://github.com/jamesmacfie/acorn/blob/b76dcd46b3f0cfbd2e0bd4620a1ef4e1f99590fd/docs/future/mods.md) (the "shipping a mod" item
is replaced), manual check 164 in [agents and providers](../../testing/agents-and-providers.md), and
the docs index.

**Decisions and deviations.**

- **The bridge program names no plugin.** An architecture rule forbids a library naming a plugin
  route, so agents writes the route and version into the installed command
  (`loop-hook.js /v1/p/agents/loop-hook agents.loopHook.v1 claude PreToolUse`), and the program checks
  only that the route is under `/v1/p/`.
- **An ask that expires denies.** The design leaves expiry to this phase. Nobody approving is not
  approval, and the bridge's own failures stay no decision. The hold is 570 s, 30 s inside the 600 s
  hook timeout acorn installs, which is also Claude's default.
- **A cancelled turn expires an ask's card at once, but the hold runs to its timer.** The comment in
  `holdAsk` says so. The harness has usually killed the hook by then.
- **`after-tool`'s `succeeded` is always `true` on Claude.** Claude sends `PostToolUse` only for a
  call that finished. `PostToolUseFailure` isn't installed.
- **Mods weren't used.** Command hooks work and cost about 57 ms a call, so the Mods module stays the
  fallback the design names. Whether Mods still needs an early-access flag wasn't checked.
- **The service boot budget rose 8 KB to 3,157,000 B.** HEAD measured 3,148,541 B. Answering a call,
  holding an ask, the Claude mapping, and coverage load on first use. The two point declarations, the
  `ask` branch, the route, and the start's handler check load at boot.
- **No `omp` bridge.** `omp` isn't installed and its source isn't on this machine, so its
  `tool_call` deny API couldn't be verified at phase 01's commit. Writing an extension blind would ship
  unverified code. It joins DeepSeek on `before-permission` only.

**Codex limitation, with evidence.** Codex 0.159.2 (`codex app-server generate-json-schema`, its
binary, and its hooks documentation, checked 2026-10-07):

- A hook added with `-c hooks.PreToolUse=…`, the session-flag layer that `thread/start`'s `config`
  also feeds, is listed by `hooks/list` as `source: "sessionFlags"`, `isManaged: false`,
  `trustStatus: "untrusted"`, with key `/<session-flags>/config.toml:pre_tool_use:0:0`.
- Trust is a hash a person records with `/hooks`, written by `config/batchWrite` as
  `hooks.state."<key>".trusted_hash` into `~/.codex/config.toml`. That's the person's own settings.
- Managed hooks come only from system, MDM, cloud, or `requirements.toml` layers, which an
  administrator owns.
- The remaining doors are `--dangerously-bypass-hook-trust` and the `bypass_hook_trust` override,
  which also skip trust for the person's own hooks. Passing a `hooks.state` hash as a session flag
  would trust a hook from the same untrusted layer, which is the bypass by another name. Neither is
  used.

So Codex ships without a bridge and reports neither loop capability. Settings says its tool calls
reach a policy only when Codex asks.

**Verify-before-building answers.** The adapter still spreads `claudeCode.options`, `settings` and
`hooks` included (`acp-agent.js`, claude-agent-acp 0.54.1, SDK 0.3.197). Claude's input carries
`tool_use_id`, which equals the ACP `toolCallId`. Claude runs every matching hook from every source in
parallel: on 2.1.292, in `bypassPermissions`, a deny from a `--settings` hook refused `git status`
that James's own `rtk` `PreToolUse` hook approves. Codex's input carries `tool_use_id`, and its deny
reaches the model through `permissionDecisionReason`, per its documentation; untested, because Codex
has no bridge. Codex's default hook timeout is 600 s.

**Verification.**

- `pnpm lint` passes. `@acorn/arch-tests`: 86 passed, with the published surface pin regenerated for
  `HookVerdict.ask` and `PluginHookRegistry.handlers`. `apps/node` `pnpm build` passes the budget at
  3,156,057 B.
- `hooks.test.ts`: an ask holds, the first ask wins, a later veto still refuses, a point that doesn't
  allow `ask` never calls one, and a stalled ask asks nothing.
- `loopHooks.test.ts`, through the real hook chain across two plugin contexts: no handler installs no
  bridge and answers nothing, one handled point installs only that point, a veto denies with its
  reason and the permission subject and `toolCallId`, another task's or an unknown session gets
  nothing, an ask raises a card that a refusal denies and an approval leaves undecided, a throwing
  handler leaves the call alone, and an after-tool note is trimmed and capped at 4,096 characters.
- `claudeLoopHook.test.ts` from recorded Claude input: the subject, the three answers and no allow,
  and settings that install only handled points with a quoted command. `routes/loopHook.test.ts`:
  the token names the session, and a device, a token with no session, or an unknown body gets no
  decision. `node-core` `mcp/loopHook.test.ts` runs the real program: it forwards with the token and
  prints the reply, and a stopped Node, an error reply, or bad input prints nothing and exits zero.
- `permissionLines.test.ts`: the `ask` line and its high mark. The manifest schema and the
  `pluginDisable` and `routeRegistry` goldens carry the new route and capability.
- The full `pnpm test` ran once on Node 24.11. On top of it, under Node 26.8.1: `@acorn/node-core`
  1,628 passed, with the 3 known `storage/backup.test.ts` failures. `@acorn/node` 271 passed, with
  the known `routeRegistry.test.ts` red, whose only remaining difference is
  `POST /v1/p/terminal/tasks/:taskId/setup`. `@acorn/tui` 676, `create-acorn-plugin` 22,
  `@acorn/plugin-api` 14. On Node 24.11: `@acorn/plugin-agents` 1,174, `@acorn/client-core` 2,460
  with the known `scopes.test.ts` and `cssHygiene` reds, `@acorn/desktop` 171 with the 11 known
  `clientPluginDisable.test.ts` cases, `@acorn/protocol` 294, `@acorn/plugin-workflows` 568, and every
  other package green.
- The package: `node --test` in `permission-policy` passes 14.

Real host, `pnpm dev:agent -- --session pi-phase-10 --project /tmp/p10-repo`, Claude Code 2.1.292,
Opus 5.5:

- The policy installed through `POST /v1/core/plugins/install` and was active after a Node restart.
  The trust prompt listed "Stop agents from doing “run any tool”" and "Make a tool wait for you before
  agents can “run any tool”" (`p10-policy-trust.png`).
- The **Permissions** tab's **Agents it reaches** read "Claude Code: Every tool call, and every tool
  result." and "Codex: Only the tool calls it asks you about." That matches the providers' reported
  capabilities (`p10-coverage.png`).
- In **Bypass Permissions**, `git push --force nowhere-remote HEAD` failed before it ran, and the
  agent quoted "PreToolUse:Bash hook error: Blocked by acorn-permission-policy: Force-pushing
  rewrites shared history…" in the same turn (`p10-claude-veto.png`). James's `rtk` hook, which
  approves git, didn't let it through. Phase 02's limitation is gone on Claude.
- `git push nowhere-remote HEAD` raised a card, "acorn-permission-policy wants you to decide: This
  pushes commits to a remote…", and the session showed **Needs you** (`p10-ask-card.png`). **Reject**
  failed the call with "The person refused this when acorn-permission-policy asked them…"
  (`p10-ask-refused.png`). **Allow** let Claude's own checks run, and git failed on the missing
  remote (`p10-ask-allowed.png`).
- An Edit to `src/push.ts` returned "PostToolUse:Edit hook additional context: Test first: you changed
  src/push.ts before any test in this session…".
- The Claude process's `--settings` held the hook, run by the app's bundled Node against
  `dist/helper/loop-hook.js`. `~/.claude/settings.json` was last written 2026-10-06.
- Latency: 15 calls from the bundled bridge to the live Node took a median of 57 ms (55 to 61), a
  refusal 57 ms. With no Node to reach, 28 ms.
- Screenshots are in the session's ignored `.acorn/agent-dev/pi-phase-10/screenshots/`.

**Limitations.**

- **No Codex bridge**, as above. **No `omp` or DeepSeek bridge**, by design for DeepSeek and for lack
  of `omp`.
- **A killed bridge, a stopped Node, and a slow handler weren't forced on the real host.**
  `loopHook.test.ts` in node-core runs the real program against a stopped Node, an error reply, and
  bad input. `loopHooks.test.ts` in agents covers a throwing handler, and the hook runner's own tests
  cover a stalled one.
- **The terminal client wasn't driven.** The ask card is the shared request card, which both hosts
  draw, and the coverage section is desktop-only: the terminal client has no plugin page.
- **The transform trust line reads "Change what agents does when it “read a tool result”s".** The
  shared sentence appends an "s" to the label, as it does for `before-send`'s "send a prompt". Not
  changed here.
- **`~/.codex/config.toml` was rewritten at Node boot** by the terminal plugin's existing
  `acorn-dev` MCP re-registration ([MCP § Configuration](../../mcp.md#configuration)), which now
  points at this worktree. That's pre-existing behavior, not the bridge.

**For phase 11.** Run manual check 164 with a signed-in Claude Code. Codex, DeepSeek, and `omp` reach
policy only through `agents:before-permission`. A plugin's tool hooks reach a running session after
its next resume. A bridged deny reaches the model in the turn, so the explanation note from phase 03 is
only for permission-hook refusals.

## Outcome

A loaded policy plugin refuses, holds for the person, or annotates every tool call a bridged harness
makes, not only the calls it asks about. Claude Code has a bridge. Codex has one, or an evidenced
limitation explaining why a host can't install a trusted hook. No bridge reply ever approves a tool.

## Design

The design as proposed on 2026-10-07. The implementation steps below refine it and win where they differ.

### Why

This programme's [README](./README.md) rests on one finding: the agent loop belongs to the harness, so
an acorn plugin reaches only its edges. That is still true of acorn's own process. What changed is
that every harness family acorn drives now publishes hooks inside its own loop:

- Claude Code has command hooks in its settings and, since Mods, in-process function hooks. The
  [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference) was public at v2.1.290 on
  2026-10-07, with `tool.call`, `tool.check`, `prompt.context`, `session.append`, `session.compact`,
  and `agent.spawn` among its events.
- Codex shipped a [hooks system](https://learn.chatgpt.com/docs/hooks) shaped like Claude's command
  hooks: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `UserPromptSubmit`, `Stop`,
  `SubagentStop`, and others. Its documentation says hooks run under `app-server` as well as the
  interactive CLI.
- `omp` loads TypeScript extensions with `tool_call` and `tool_result` events
  ([phase 01](./01-omp-harness.md)).

Acorn already passes data into every session it starts. `claudeHarness.ts` sends
`claudeCode.options` through `acpSessionMeta`, and the ACP adapter spreads those options into the
Agent SDK's own (`@agentclientprotocol/claude-agent-acp` 0.54.1, checked 2026-10-07). `codexStart.ts`
sends a `config` object on `thread/start` and `thread/resume`.

So acorn can put a small bridge into each harness that calls back into acorn at a loop point and
returns acorn's answer in the harness's own words. A plugin author writes against acorn's points
once. The bridge, not the plugin, knows each harness's spelling. Acorn still owns no loop, and
[refused.md](./refused.md) still refuses everything that would need one.

A person-installed Claude Code mod that reports to acorn is planned outside this programme. It is
the same idea from the other side, so the ingress below is a versioned contract that mod can target.

### What each harness offers at the two first points

| Acorn point | Claude Code | Codex | `omp` |
| --- | --- | --- | --- |
| Before a tool runs | `PreToolUse` command hook, or Mods `tool.call`. Deny with a reason the model reads. | `PreToolUse` with `permissionDecision: deny`. | `tool_call`, which can block. |
| After a tool runs | `PostToolUse` with `additionalContext` | `PostToolUse` with `additionalContext` | `tool_result` |

Prompt context, compaction, subagent start, and stop-blocking exist in two or more harnesses too.
They are left for later, each with a trigger, in [Later](#later-each-with-its-trigger).

### The shape

#### Two new points, owned by agents

Agents declares both beside `before-send` and `before-permission`, with `ctx.hooks.declare`.

`agents:before-tool` allows `observe`, `veto`, and a new `ask` mode. It uses `onTimeout: 'allow'`,
`order: 'install'`, and a 5,000 ms timeout, for the reasons
[permission policy](../../managed-agents/permission-policy.md#where-it-runs) gives for the permission hook. Its
payload is the tool subject phase 02 defines for `agents:before-permission`, so a policy plugin
registers one function and points it at both:

| Field | Meaning |
| --- | --- |
| `sessionId`, `taskId`, `providerId`, `unattended`, `root` | As on `before-permission`. |
| `toolCallId` | The harness's tool call ID when the bridge has one, otherwise `''`. A handler uses it to recognize the same call when the permission hook fires for it afterward. |
| `toolName` | The harness's own tool name, such as `Bash`. |
| `kind`, `title`, `command`, `paths` | The shared subject vocabulary, `AgentPermissionSubject` ([permission policy](../../managed-agents/permission-policy.md#the-payload)). |

`agents:after-tool` allows `observe` and `transform`. Its payload is the same subject plus
`succeeded: boolean` and `note: string`, which starts empty. A transform may set `note`, bounded to
4 KiB, and the bridge returns it as the harness's `additionalContext`. That covers the common hook
packages in the Claude ecosystem: run the linter or the tests after an edit and tell the model what
broke, inside the turn rather than in a later one.

#### The `ask` verdict

`ask` is a fourth hook mode in core's registry, and a point opts into it through `allows`. A handler
answers `{ ask: true, reason }`. Agents then raises an ordinary permission request on the session,
naming the plugin and reason, and holds the bridge call until the person answers. A refusal goes back
to the harness as a deny. An approval goes back as no decision, so the harness's own checks still run.

`ask` only makes a session stricter, so it isn't auto-allow. It is the harness-neutral form of
Claude's `tool.check` returning `ask`, and of community mods that make a person confirm destructive
commands. The trust prompt names it separately from veto: "can make a tool wait for you".

#### The bridge never approves

Every bridge reply is one of: deny with a reason, a context note, or no decision. It never returns
allow, even when the person approved an `ask`. A timeout, a crash, an unreachable Node, or a bad
reply is no decision. So a broken bridge leaves the session exactly as strict as the harness made
it, and acorn's rule that no plugin approves on the person's behalf holds inside the loop too.

#### How each bridge is installed

Acorn owns one small bridge program, built as an entry beside `mcp.js`, the way
`apps/node/src/entries/mcp.ts` is. The program does nothing but forward. It reads the harness's hook
input, posts it with the harness and event names to the Node, and prints the reply the Node
composed. Mapping each harness's fields into the subject lives in agents beside that harness's
normalizer, where phase 02 puts permission subject extraction, so it is tested in one place.

- **Claude Code.** Add command hooks to the `settings` object acorn already sends in
  `claudeCode.options`. Command hooks are a stable, documented interface that mirrors Codex. Move to
  a Mods module, loaded through the SDK's `plugins: [{ type: 'local', path }]`, only if the per-call
  process cost measures too high. The person's own user and project hooks keep running, because the
  adapter keeps `settingSources`.
- **Codex.** Add `[[hooks.PreToolUse]]` and `[[hooks.PostToolUse]]` entries to the `config` object
  beside `mcpConfig`. Codex skips a non-managed hook until a person trusts its exact definition, and
  its bypass flag also bypasses trust for the person's own hooks. Phase 10 must find a supported way
  for a host to install a hook, such as a managed layer, or ship Codex without a bridge and record the
  limitation. Never pass the bypass flag.
- **`omp`.** An `omp` extension in the contributed harness package from
  [phase 01](./01-omp-harness.md), posting to the same route.
- **DeepSeek and other ACP harnesses.** No bridge. They keep `before-permission` only.

#### Install only what has a handler

A command hook is a process spawn and a round trip on every tool call. At session start and resume,
agents installs a bridge entry only for a point with at least one enabled handler. A handler that
registers mid-session takes effect at the next resume. Say so in the plugin authoring docs. A bridge
call that arrives with no handler registered returns no decision without running the chain.

#### The ingress

One agents route under the task principal acorn's MCP server already uses. The bridge inherits the
same launch environment ([MCP § Launch environment](../../mcp.md#launch-environment)). The token,
not the request body, decides the task and session. A body names `harness`, `event`, and the raw hook
input, bounded in size. A session the token doesn't own gets no decision.

Version the request and reply shapes as `agents.loopHook.v1` in the agents contract. That is the
shape a person-installed acorn mod would post too. Sessions acorn didn't start have no task token,
so admitting them needs its own principal. That's an open decision for whoever builds the mod, not
part of phase 10.

#### Coverage is visible

Add `loop_before_tool` and `loop_after_tool` to `AgentCapability` in
`plugins/agents/src/contract/wire.ts`. A driver reports them only when its bridge is installed and
verified for the running harness version. **Settings → Plugins** shows, for a plugin that handles
these points, which harnesses each one reaches. A policy that applies to every Claude and Codex tool
call but only to asked questions in DeepSeek must say so where the person turns it on.

#### Relation to the permission hook and explanations

`before-permission` stays. It's the only coverage for harnesses without a bridge, and it still sees
questions a bridge wouldn't, such as a Codex network grant. A handler registered on both sees a call
twice when the bridge lets it through and the harness then asks. `toolCallId` lets it answer the same
way both times.

A bridge deny carries its reason to the model inside the turn. Where a bridge exists, the separate
explanation turn from [phase 03](./03-session-messages.md) is unnecessary. It remains the
fallback for harnesses without one.

### What stays refused

- **Returning a tool's result instead of running it.** Mods' `{ result }` and `omp`'s tool shadowing.
  The transcript would show a call that never ran.
- **Rewriting tool input.** Codex and Claude both accept an updated input from `PreToolUse`. A plugin
  that changes the command a person approved is a larger grant than a veto. Revisit when a real
  consumer needs it, as its own mode.
- **Rewriting tool output before the model reads it.** Only Claude's Mods (`session.append`) can do
  this. Codex's `PostToolUse` can add context but not change output. Revisit when a second harness
  supports it and a secret-redaction consumer asks.
- **Hooks on the token stream and generic middleware.** Unchanged from [refused.md](./refused.md).

### Later, each with its trigger

- **Prompt context inside the harness.** `agents:before-send` and context sections already cover
  every prompt acorn sends. Add a bridge point only for prompts acorn doesn't send, such as a
  terminal-controlled session. Trigger: a consumer that needs it there.
- **Before compaction.** Claude and Codex both expose it. Trigger: a consumer that must save or veto
  something before compaction.
- **Subagent start.** Claude's `agent.spawn` can deny or pick a model. Codex reports `SubagentStop`.
  Trigger: a policy over subagents, and a second harness that can refuse one.
- **Blocking the end of a turn.** `Stop` with `block` makes Claude and Codex keep going. It overlaps
  the unattended turn-ending instruction in `claudeHarness.ts`. Trigger: evidence the instruction
  isn't enough.

## Ownership and data flow

Harness hook fires → acorn's bridge program forwards the raw input → agents ingress under the task
token → per-harness mapping beside the normalizer → `agents:before-tool` or `agents:after-tool` →
verdict → reply composed in the harness's own words → bridge prints it. An `ask` verdict detours
through an agents permission request and the shared card before the reply.

Read `claudeHarness.ts`, `codexStart.ts`, both normalizers, phase 02's subject type and hook,
`packages/node-core/src/server/pluginHost/hooks.ts`, `apps/node/src/entries/mcp.ts`, and
[MCP § Launch environment](../../mcp.md#launch-environment). Core owns hook modes. Agents owns the
points, ingress, mapping, and installation. The bridge program owns nothing but forwarding.

## Implementation

1. Add the `ask` mode to core's hook registry. A point opts in through `allows`. Add its trust copy
   and its verdict shape, and keep it out of every existing point.
2. Declare `agents:before-tool` and `agents:after-tool` with the payloads in the design above.
   Reuse phase 02's subject type and add `toolCallId`.
3. Build the bridge program as an entry beside `mcp.js`. It reads stdin, posts to the Node, and
   prints the reply. Any failure prints the harness's no-decision reply and exits zero.
4. Add the ingress route and the `agents.loopHook.v1` request and reply types. Authenticate with the
   task token. Map each harness's input into the subject beside its normalizer, with tests from
   recorded hook input.
5. Install for Claude through `settings.hooks` in `claudeCode.options`, merged with the settings
   acorn already sends, and only for points with an enabled handler. Measure per-call latency.
6. Find a supported way for a host to install a trusted Codex hook under `app-server`. If there is
   none, ship Codex without a bridge, report no loop capability, and record the evidence. Never pass
   Codex's trust bypass flag.
7. Implement `ask` end to end: raise a permission request naming the plugin, hold the bridge call,
   and answer deny on refusal or no decision on approval. Bound the hold by the harness's hook
   timeout and say what happens when it expires.
8. Report `loop_before_tool` and `loop_after_tool` per verified harness version, and show coverage in
   **Settings → Plugins** for a plugin that handles these points.
9. Extend phase 02's policy plugin to register on `before-tool` and add a test-first guard on
   `after-tool` that returns a note. Keep its rules hard-coded.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove:

- In a Claude session that allows every tool, a bridge veto stops a forced push and the model reads
  the reason in the same turn.
- An `ask` verdict raises a card, a refusal denies the call, and an approval lets the harness's own
  checks run.
- A killed bridge, a stopped Node, and a slow handler all leave the call to the harness unchanged.
- A session with no registered handler installs no bridge entries.
- The same call reaching both `before-tool` and `before-permission` carries one `toolCallId`.
- Coverage shown in Settings matches what each harness reports.

## Documentation and handoff

Update [node extension points](../../plugins/node-side-extension-points.md), the hook table in
[hooks](../../plugins/hooks.md#hooks), [managed agents](../../managed-agents.md),
[MCP](../../mcp.md), and [security](../../security.md). Record the Claude and Codex versions
tested and the measured per-call latency. Mark [mods.md](https://github.com/jamesmacfie/acorn/blob/b76dcd46b3f0cfbd2e0bd4620a1ef4e1f99590fd/docs/future/mods.md)'s "shipping a mod into
Claude sessions" item as delivered or replaced.

## Verify before building

Check Claude's and Codex's hook timeouts, whether a hook added through `settings` runs before or
after the person's own hooks, and these:

- The Claude adapter still spreads `claudeCode.options`, including `settings` and `plugins`, into the
  SDK's options. Checked in `acp-agent.js` of `claude-agent-acp` 0.54.1 and SDK 0.3.197.
- The hook input from each harness carries a tool call ID, and Codex's deny reason reaches the model.
- How a host installs a trusted hook in Codex 0.159.2 or later under `app-server`.
- Whether Mods still needs an early-access flag in the Claude Code build acorn bundles.
- The `omp` extension API for `tool_call` deny reasons at the commit phase 01 pins.
