# Phase 07: native skill delivery

Status: proposed, 2026-10-03. Entry: phase 06 accepted with the portable delivery catalogue. Next:
[phase 08](./08-resource-read-experiment.md).

## Outcome

Claude receives the enabled skills through its verified local-plugin interface. Codex receives them
natively if its app-server supports an additive skill root; otherwise its tested portable delivery
remains the accepted outcome. The composer presents only choices the running session actually has.
Source: [native delivery design](../06-agent-content.md#delivery-in-two-layers).

## Ownership and data flow

Phase 06 catalogue and enablement → agents per-session delivery planner → harness-specific adapter
→ native runtime skill list → agents wire descriptors → broker/cache → shared composer.
Keep native protocol knowledge in the drivers and reuse the core catalogue and host trust decision.

Read `plugins/agents/src/server/drivers/claudeHarness.ts`, `codexDriver.ts`, `codexConfiguration.ts`,
`plugins/agents/src/contract/wire.ts`, and composer skill handling. Inspect the pinned SDK/adapter
and app-server schemas before deciding supported configuration; the source proposal leaves Codex's
door unverified.

## Implementation

1. Confirm the Claude SDK local-plugin-folder and readable-directory options, their ACP adapter
   forwarding, and support on both new and resumed sessions. Record the provider versions and exact
   option names. Do not assume `_meta.claudeCode.options` passes every SDK option unchanged.
2. Build a session-owned plugin folder under the Node data root from accepted enabled skills.
   Preserve standard skill files/supporting assets, namespace collisions, and immutable generation
   ownership. Pass only that folder to the harness; never edit `.claude/skills` in the worktree.
   Retain a generation while a process uses it, and clean it on archive/shutdown/replacement without
   invalidating a live provider's reads.
3. Inspect Codex `thread/start`, `thread/resume`, skill listing/configuration, and public extra-root
   support. Use an additive root only when it preserves the user's configured skills and credentials.
   Never relocate `CODEX_HOME` or copy credentials. If no supported root exists, record that finding
   and keep phase 06 delivery. This is an accepted fallback, not unfinished implementation.
4. Select one delivery method per skill per session: native when verified, otherwise portable when
   readable, otherwise unavailable with a reason. Remove the portable index entry only after native
   delivery is established. A failed native setup must restore a valid portable plan or show the
   failure without hiding the skill.
5. Map native names back to canonical plugin skill IDs. Refresh skill descriptors at process start
   and resume, preserve harness-native procedures from other sources, and avoid duplicate composer
   choices. Present only invocation syntax the harness supports. Do not claim ACP has a native
   skill API or add an unverified universal slash-command expansion path.
6. Show the chosen mode and relevant limitations in phase 06's delivery status. Keep settings,
   composer, and protocol metadata scoped to the selected Node and active session generation.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove new/resume configuration,
no duplicate index entry, native failure fallback, stale generation rejection, asset retention, and
cleanup. Cover coexistence with user skills and two plugins using the same local skill ID.

On real Claude sessions, select and load a contributed skill through supported native syntax,
then disable and resume. Check that login and worktree files are unaffected. On Codex, prove either
native start/resume/listing or a recorded absence of the door with working portable delivery. Inspect
composer and plugin status on desktop and terminal; record any provider-specific invocation limit.

## Documentation and handoff

Update [managed agents](../../../managed-agents.md),
[client surfaces](../../../managed-agents/client-surfaces.md),
[manifest authoring](../../../plugin-authoring/the-manifest.md), and provider checks. Publish the
portable/native/unavailable matrix, refresh timing, and credential-preserving Codex disposition.
Retain importer/discovery work under the original topic's deferred section, not as a phase task.

## Verify before building

Recheck phase 06's delivered IDs and staging ownership, official pinned provider configuration,
resume semantics, skill invocation syntax, and whether native metadata really reaches the ACP client.
Do not mark a composer choice available solely because a folder was successfully written.
