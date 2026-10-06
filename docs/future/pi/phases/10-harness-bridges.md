# Phase 10: harness bridges

Status: proposed, 2026-10-07. Entry: phase 09 accepted with its loaded consumers. Next:
[phase 11](./11-programme-acceptance.md).

## Outcome

A loaded policy plugin refuses, holds for the person, or annotates every tool call a bridged harness
makes, not only the calls it asks about. Claude Code has a bridge. Codex has one, or an evidenced
limitation explaining why a host can't install a trusted hook. No bridge reply ever approves a tool.
Source: [harness bridges](../08-harness-bridges.md).

## Ownership and data flow

Harness hook fires → acorn's bridge program forwards the raw input → agents ingress under the task
token → per-harness mapping beside the normalizer → `agents:before-tool` or `agents:after-tool` →
verdict → reply composed in the harness's own words → bridge prints it. An `ask` verdict detours
through an agents permission request and the shared card before the reply.

Read `claudeHarness.ts`, `codexStart.ts`, both normalizers, phase 02's subject type and hook,
`packages/node-core/src/server/pluginHost/hooks.ts`, `apps/node/src/entries/mcp.ts`, and
[MCP § Launch environment](../../../mcp.md#launch-environment). Core owns hook modes. Agents owns the
points, ingress, mapping, and installation. The bridge program owns nothing but forwarding.

## Implementation

1. Add the `ask` mode to core's hook registry. A point opts in through `allows`. Add its trust copy
   and its verdict shape, and keep it out of every existing point.
2. Declare `agents:before-tool` and `agents:after-tool` with the payloads in the source proposal.
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

Update [node extension points](../../../plugins/node-side-extension-points.md), the hook table in
[hooks](../../../plugins/hooks.md#hooks), [managed agents](../../../managed-agents.md),
[MCP](../../../mcp.md), and [security](../../../security.md). Record the Claude and Codex versions
tested and the measured per-call latency. Mark [mods.md](../../mods.md)'s "shipping a mod into
Claude sessions" item as delivered or replaced.

## Verify before building

Everything in the source proposal's list, plus Claude's and Codex's hook timeouts and whether a hook
added through `settings` runs before or after the person's own hooks.
