# Phase 02: permission veto and policy plugin

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry: phase 01 disposition
recorded. Next: [phase 03](./03-session-messages.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-02-permission-veto`, at the commit titled "Phase 02: Permission veto
and policy plugin". [Permission policy](../../managed-agents/permission-policy.md) is the owning
contract.

- `agents:before-permission`, declared beside `before-send` from `BEFORE_PERMISSION_HOOK` in
  `plugins/agents/src/contract/permissionHook.ts`. Observe and veto, install order, 5,000 ms,
  `onTimeout: 'allow'`. The payload carries the Mods fields plus `requestId` and `toolCallId`. The
  subject fields are the public `AgentPermissionSubject` type for phase 10 to reuse.
- Both drivers emit a driver-only `permission_request` event (`drivers/types.ts`) that carries the
  normalized request, the subject, and `open()` and `respond()` closures over the parked entry. A veto
  reaches the request even while `start` is still running. The materializer keeps only the request,
  so the subject never reaches the wire, SQLite, or telemetry.
- `server/sessions/permissionPolicy.ts` runs the hook before the provider event queue. It's loaded on
  the first permission request to stay inside the service boot budget.
- The request event and its row gain optional `blocked: { by, reason }`. A blocked row is inserted
  `resolved`. Both state reducers, the webhook and `agent-session:changed` filter, and the bounds treat
  it as answered. `agents.requests` adds `blocked` on resolved rows. Raw resolution stays private.
- The resolved card on both hosts says "Blocked by `<plugin>`: `<reason>`", and the thread keeps a
  blocked permission that it would otherwise drop once resolved.
- The policy package is
  [`docs/future/pi/packages/permission-policy/`](./packages/permission-policy/README.md), with
  `node --test` coverage of every command form it claims.

No migration: `blocked` lives in the existing `resolution_json`. The wire change is additive, and an
older client draws a blocked row as an ordinary resolved request.

**Decisions and deviations.**

- **Two pre-existing bugs fixed, both found by the real-host run.** First, `loadedPluginBinding` in
  `packages/node-core/src/server/plugins/loader.ts` had dropped `extensionPoints` and `extensions`
  since the Findings removal (`aa91856aa`). Every manifest hook handler and loaded hook point installed,
  showed its grant, and never ran. `reload.test.ts` now drives a folder package's route-backed veto
  through the loader and the host. Second, a node-only package never reaches the device trust prompt,
  so its cross-plugin grants appeared nowhere. The plugin's **Permissions** tab
  (`PluginPage.tsx`) lists them. Harness grants are still missing from that tab; that's out of scope.
- **The trust line quotes the contributor's label, not the owner's.** "Stop agents from doing “…”"
  reads the extension's own `label`, so the package uses the point's verb phrase,
  `run a tool the agent asks permission for`.
- **DeepSeek needs a join.** Its permission request names only the tool call. The command arrives on
  the earlier `tool_call` update, and every tool is kind `other` with no `locations`. The ACP driver
  merges request and update by `toolCallId`, capped at 100 recent calls. The policy reads `command`
  whatever the kind.
- **A Codex command's `cwd` goes in `paths`.** The policy doesn't read it.
- **The summary omits a separate request ID.** `agents.requests` gives `blocked: { by, reason }`.
  The canonical provider request ID is already the row's `requestId`.
- **A failed or withdrawn veto writes a warning and no request row.** The request was never shown,
  so there's nothing to resolve. An allowed request the harness withdrew during the wait is dropped
  the same way. This avoids a pending row recorded after its own turn ended.
- **The service boot budget rose 2 KB to 3,118,000 B.** The policy step is lazy; the remaining 2 KB
  is the declaration and the `blocked` branches that run on every event.

**Verification.**

- `pnpm lint` passes.
- `@acorn/plugin-agents`: 1,121 passed. `permissionPolicy.test.ts` drives the real hook chain across
  two plugin contexts. It covers veto picking reject-once, cancel with no reject-once option, veto
  during driver startup, a throwing handler, a 5 s stall with traffic still streaming then pending,
  the asking turn kept after it completes, a withdrawn request, and a replaced generation. A mutation
  check confirmed that removing the generation guard or the resolved insert fails a test.
- `@acorn/tui`: 676 passed, including the blocked card in a 120 by 40 render. Run with patched Node
  26.8.1.
- `@acorn/node-core`: all pass but `storage/backup.test.ts`, which times out under Node 26.8.1 and
  passes under 24.11. This change doesn't touch it.
- `@acorn/client-core`: 2,453 passed. Two failures are in files this change doesn't touch:
  `scopes.test.ts` (the `workspaceProjectOrderRoute` classification) and the `cssHygiene` box-shadow
  ratchet.
- `@acorn/arch-tests`: 86 passed.

Real host, `pnpm dev:agent -- --session pi-phase-02`, Claude Code through ACP, Opus 5.5:

- With the package installed and the Node restarted, the **Permissions** tab reads "Stop agents from
  doing “run a tool the agent asks permission for”", marked **Broad access**.
- In **Default** mode, `rm -rf /tmp/acorn-pi02-outside` drew no card. The transcript shows a resolved
  permission, "Blocked by acorn-permission-policy: rm would remove /tmp/acorn-pi02-outside, outside
  this task's worktree.", the Bash call failed, the session returned to **ready**, and the directory
  survived.
- Screenshots `pi02-policy-permissions.png` and `pi02-claude-blocked.png` are in the session's
  ignored `.acorn/agent-dev/pi-phase-02/screenshots/`.

**Limitations.**

- **Claude `git push --force` never reached the hook on this machine.** James's
  `~/.claude/settings.json` has an `rtk` `PreToolUse` hook on Bash that approves the git commands it
  rewrites, and his `defaultMode` is `auto`. That's the documented limit: an already-allowed tool
  never asks. The force-push rule is covered by `policy.test.mjs`, and the deletion rule proved the
  same path end to end.
- **Codex wasn't run.** codex-cli 0.159.2 is installed, but its account hit its usage limit until
  2026-10-10. The Codex mapping, `decline` answer, and parked-request path are covered by
  `codexNormalizer.test.ts` and the shared runtime tests. Manual check 156 in
  [agents and providers](../../testing/agents-and-providers.md) is owed for Codex.
- **DeepSeek and `omp` weren't run.** Neither `dsh` nor `omp` is on this machine. DeepSeek's request
  shape comes from its source (`references/deepseek-harness/packages/acp/acp/src/index.ts:155-172`
  and `updates.ts:52-61`), and the driver test covers it. `omp`'s permission input is unverified,
  which the package README records as a policy coverage limitation.
- **No terminal-client PTY run.** The TUI driver's fixtures don't seed a blocked request. The
  shared card's terminal render is covered by `apps/tui/src/agents.test.tsx` at 120 by 40.
- **`order: 'install'` sorts by handler ID.** `hookHandlersFor` breaks ties with `localeCompare`,
  not install time. With vetoes only, that changes nothing but which reason shows first.

**For phase 03.** Explain a refusal only after the resolved `plugin:agents:request-changed` event,
by reading `agents.requests` for a row whose `blocked.by` is the policy's own ID. Key each explanation
on the row's `requestId`. The package's `node.js` is where the optional explanation goes, behind its
own setting.

## Outcome

A loaded policy plugin refuses a harness permission request before Acorn shows it as pending.
Both clients show a resolved request naming the blocking plugin and reason. The plugin tightens
approval without acquiring the power to approve. The base design is the
[Mods permission hook](https://github.com/jamesmacfie/acorn/blob/b76dcd46b3f0cfbd2e0bd4620a1ef4e1f99590fd/docs/future/mods.md#the-design-agentsbefore-permission); the Pi additions are below.

## Design

The design as proposed on 2026-10-02. Where it differs from the completion note above, the completion
note records what was built.

### Why it belongs in this programme

`omp`'s most used extension event is `tool_call`. Its own quick-start example blocks `rm -rf` with
it. An acorn plugin has no equivalent for the harness's tools: `core:before-tool-call` guards only
acorn's own tools, on the agent tools route, and withholds their arguments on purpose.

The permission request is the one place every harness stops and asks acorn before running a risky
tool. [mods.md § The gap](https://github.com/jamesmacfie/acorn/blob/b76dcd46b3f0cfbd2e0bd4620a1ef4e1f99590fd/docs/future/mods.md#the-gap-harness-permission-requests) traces it through both
drivers, and [mods.md § The design](https://github.com/jamesmacfie/acorn/blob/b76dcd46b3f0cfbd2e0bd4620a1ef4e1f99590fd/docs/future/mods.md#the-design-agentsbefore-permission) puts a veto-only
hook there. That is the closest acorn can get to `tool_call` from outside the loop, and it works the
same for Claude, Codex, DeepSeek, and `omp` from [phase 01](./01-omp-harness.md).

Build it exactly as `mods.md` describes: observe and veto only, `onTimeout: 'allow'`, run in
`onProviderEvent` before the event queue, and answer a veto with the first `reject_once` option.

### Addition 1: tell the model why

The first Mods design deferred explanations until agents retried blocked commands. The sequential
plan instead makes them an optional consumer when messaging lands.
`omp` answers the same problem with `additionalContext` on `tool_call`: a handler adds
trusted text that the host places after the tool results, before the next model request.

Acorn cannot place text inside the harness's turn. It can queue a turn after it. Once
[phase 03](./03-session-messages.md) ships, the handler's plugin can follow a confirmed veto with a session
message that says what was refused and why. Phase 03 reads committed blocked state before delivery;
a late hook verdict ignored after timeout is not proof of refusal. Keep the two separate:

- The veto stays a hook verdict with a short display reason, capped by the host.
- The explanation is a session message from the same plugin, under the same per-session cap as any
  other, so a plugin that vetoes in a loop cannot also talk in a loop.

Do not make the hook queue the message itself. A hook that has side effects on another plugin's
session is a different grant from a veto, and the trust prompt would have to say so.

### Addition 2: the first consumer

`mods.md` phase 4 asks for a small loaded plugin with two hard-coded rules: no force-push, and no
destructive command outside the task root. Write it so it also exercises [phase 03](./03-session-messages.md)
once that lands, by queuing one explanation per blocked command. That gives 03 a second real consumer
besides [phase 04](./04-model-grants-and-advisor.md), at almost no cost.

### What `omp` does that this still does not

Say these in the owning docs when the hook ships:

- `omp` sees every tool call. This hook sees only the calls a harness asks about. A harness in a bypass
  mode, or a tool its own settings allow, never reaches acorn.
- `omp` can rewrite a tool's input. This hook cannot, because the harness runs its own command.
- `omp` can patch a tool's result before the model reads it. Acorn cannot reach a result at all.

For the first and the second, [phase 10](./10-harness-bridges.md) proposes a bridge through each harness's
own hooks: Claude Code and Codex now offer `PreToolUse`, so acorn can see every tool call there too.
It still refuses input rewriting. For patching results, the answer is [phase 01](./01-omp-harness.md): run
an agent whose loop takes extensions.

## Ownership and data flow

Harness parks permission request → ACP/Codex normalizer extracts driver-only subject → agents
runtime runs owner-declared hook → driver rejects once → materializer emits safe wire event →
agents store writes an already-resolved request → lifecycle and client query projection → shared card.

Read the normalizers and drivers, `plugins/agents/src/server/drivers/types.ts`,
`plugins/agents/src/server/sessions/runtimeEngine.ts`, `providerEventMaterializer.ts`,
`sessionRepository.ts`, and `lifecycle.ts`. Read the card at
`plugins/agents/src/client/sessions/AgentRequestCard.tsx`, core's hook registry, and the loaded route
carrier. Raw subject extraction belongs to the driver; policy and session state belong to agents.

## Implementation

1. Add a driver-only permission subject with kind, command, and paths. Use the Mods mapping and
   bound provider-owned values. Name the hook-facing subject fields as one public type in agents'
   contract, with `toolCallId` (`''` when unknown), because
   [phase 10](./10-harness-bridges.md)'s `agents:before-tool` reuses it. Unknown fields become empty values; do not reconstruct commands from
   display titles. Strip the subject before wire serialization, SQLite, and telemetry.
2. Declare `agents:before-permission` beside `before-send`. Retain the Mods fields and add
   `requestId`, the canonical provider request ID scoped to the session. It enables the phase 03
   consumer's idempotency key. Use `observe` and `veto`, install order, a 5,000 ms per-handler timeout,
   and `onTimeout: 'allow'`. Trust copy must distinguish observing commands from stopping them.
3. Intercept permission events before the provider event queue. Capture the live session generation
   and originating turn before awaiting hooks. Recheck ownership and cancellation before answering
   or recording. Verify a request arriving during driver startup can reach its parked resolver;
   do not assume `live.handle` is already assigned.
4. On veto, choose the first `reject_once` option. Use driver cancellation only when that option is
   absent. Never choose lasting rejection or approval. Coordinate driver reply and durable record
   so synchronous provider completion cannot race the request into a false pending state. Preserve
   the original turn ID even if the turn completes while the hook waits.
5. Add optional `blocked: { by, reason }` to the normalized request event and its persisted resolved
   projection. Host-stamp identity and bound reason text. Inspect resolution failures: a failed
   driver reply must produce an honest interrupted/expired outcome, not a claim of successful veto.
   No blocked row may transiently become pending, notify, or wake a delegated parent.
   Add an optional bounded blocked summary to `agents.requests` for committed resolved rows,
   containing blocking plugin ID, reason, and canonical provider request ID. Keep raw resolution
   private. The resolved `request-changed` event plus this read lets a consumer verify that its veto
   took effect before sending an explanation; a handler returning a verdict is not that proof.
6. Render the resolved refusal in the shared card on both hosts. Keep older ordinary resolved rows
   readable and avoid cache-key churn. Check that newly introduced metadata is preserved by event
   bounding and storage mapping.
7. Build the standalone loaded policy plugin. Refuse recognized force-push commands and recognized
   destructive commands outside `root`. State its supported command forms. Exercise the manifest
   route carrier and trust prompt, rather than proving only a compiled `ctx.hooks.handle` function.
   Leave explanation delivery for phase 03.

The rules are examples, not shell containment. No rule language, command rewriting, stream hook,
auto-allow mode, or generic middleware enters this phase.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove:

- Missing subject fields, ACP kinds, Codex commands, edits, and permissions map without invented data.
- Veto selects reject-once; absence of that option follows the documented cancellation behavior.
- Timeout or handler failure reaches human approval and never approves the command.
- Parallel provider traffic continues during a slow hook; stale callbacks cannot affect a replacement
  live generation or attribute the request to a later turn.
- A blocked request never publishes pending attention or wakes its delegated parent.
- Driver failure, Node stop, and old persisted rows retain honest state.
- A real loaded policy package blocks and displays a request on Claude and Codex, plus DeepSeek and
  `omp` when available. Unsupported raw input is recorded as a policy coverage limitation.

## Documentation and handoff

Update the hook table in [node extension points](../../plugins/node-side-extension-points.md),
[managed agents](../../managed-agents.md), [security](../../security.md), and
[provider checks](../../testing/agents-and-providers.md). Explain that timeout means human review,
and that already-allowed tools and bypass modes do not reach this hook. Retain the comparison in
Mods and link its delivered contract to the owning docs. Supply the policy package to phase 03.

## Verify before building

Recheck parked-request ordering in both drivers, event bounding, resolved-row lifecycle publication,
loaded hook routing, host reason limits, and DeepSeek's actual shell input. Inspect existing approval
metadata before adding the subject so the change preserves all shipped approval forms.

From the design:

Everything in [mods.md § Verify before building](https://github.com/jamesmacfie/acorn/blob/b76dcd46b3f0cfbd2e0bd4620a1ef4e1f99590fd/docs/future/mods.md#verify-before-building), plus whether
[phase 03](./03-session-messages.md) has shipped, which decides whether the explanation path is in scope.
