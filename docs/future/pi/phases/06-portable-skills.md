# Phase 06: portable plugin skills

Status: proposed, 2026-10-03. Entry: phase 05 accepted. Next:
[phase 07](./07-native-skills.md).

## Outcome

A manifest-only loaded plugin supplies named procedures to supported managed harnesses. The agent
sees names, descriptions, and readable body locations; it loads a body only when needed. A settings
row explains which harnesses receive each enabled skill. Source: [agent content](../06-agent-content.md).

## Ownership and data flow

Installed package bytes → core manifest validation and trust → Node skill catalogue → agents'
per-start delivery plan → harness-readable index and files → model context. Device-only settings
change Node-held enablement; Node routes, broker events, and selected-Node cache update the shared UI.

Read the manifest/schema pipeline, loaded-plugin active-versus-installed selection, trust hash and
resource grants, context assembly, agents start/resume, and standing context. In the inspected code,
standing context is captured on session creation. Do not assume saving an index there refreshes it
on resume. MCP declaration refresh is a lifecycle precedent, not a skill delivery implementation.

## Implementation

1. Add `contributions.skills` with `id` and package-relative `path` to the manifest contract,
   runtime parser, published schema, and authoring types. Keep the standard `SKILL.md` shape and
   namespaced runtime name `<pluginId>:<id>`. Validate UTF-8 byte sizes: 1,024 characters for the
   description and 64 KiB for the body, preserving the original proposal's units. Validate name,
   required frontmatter, duplicates, control characters, and malformed content with named failures.
2. Confine both the declared folder and resolved `SKILL.md` to the immutable accepted package.
   Reject symlink escapes and traversal. Supporting files must remain under the skill folder when
   delivered. Track content by the active trusted bundle hash; do not present an installed candidate
   as content from the running accepted plugin. Ensure manifest-only content participates in hash
   verification, packaging, distribution, and update reapproval.
3. Build a core-owned catalogue projected through a narrow public contract. Agents consumes it
   without reading core internals or another plugin's database. Keep Node-held enablement and
   installation state distinct. A disabled/unaccepted skill is excluded from the next delivery.
4. Build the agents-owned index for every provider process start and resume. Merge it into the
   harness startup instructions through the driver's supported seam, separately from persisted
   standing context. Names, descriptions, and absolute body locations are data, with fixed host
   instructions to read matching procedures. Bound total index delivery and surface omissions;
   do not silently truncate a skill into invalid text or send every body eagerly.
5. Prove body readability using least access. A local harness may receive read access to immutable
   enabled skill folders; never grant the whole data root, which contains private state and secrets.
   Do not widen write access or mutate the user's worktree. A host-held session staging folder is
   permitted if required by the harness, provided copied files are confined and immutable for that
   delivery generation. Unsupported readability produces no index and a named status.
6. Keep a per-session delivery generation: enabling/disabling changes take effect at the next actual
   start/resume, not an active turn. Report eligibility separately from verified delivery. A process
   resumed with stale skills must not claim refreshed delivery. Handle remote Nodes using their
   paths and install bytes, rather than the client's filesystem.
7. Add host-owned medium trust copy listing procedure names/count, per-skill switches, and delivery
   status on both hosts. Use Node routes and shared UI kit. A skills-only package must install
   without requiring a Node or client entry bundle.
8. Supply one standalone skills-only package, with a supporting file, and exercise its procedure in
   Claude, Codex, DeepSeek, and `omp` where supported. Record precise reasons for any unsupported
   harness rather than inventing a generic ACP skill feature.

Always-on rules remain context sections. Do not add glob-triggered rules, marketplace discovery,
Claude shell hooks, language-server setup, subagent formats, or worktree configuration writes.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove package path confinement,
symlink escape rejection, malformed frontmatter, size bounds, duplicate IDs, and update hash changes.
Cover a manifest-only package, disabled skills on next resume, active-versus-installed mismatch,
limited filesystem grants, missing body readability, and total-index omission reporting.

In real sessions the agent loads the procedure and supporting file without eager body injection.
Enable/disable and restart one session, inspect settings/transcript on both hosts, and verify the
worktree stays free of generated configuration. Test a remote/selected-Node change so no client-local
path or cached delivery status is reused for another Node.

## Documentation and handoff

Update [manifest authoring](../../../plugin-authoring/the-manifest.md),
[contribution kinds](../../../contribution-kinds.md), [managed agents](../../../managed-agents.md),
[security](../../../security.md), and [state ownership](../../../state-ownership.md).
Record the public catalogue/delivery contract, trust-hash coverage, portable per-harness matrix,
staging lifetime, and consumer package. Phase 07 consumes that contract rather than inventing a
second skill registry.

## Verify before building

Read official frontmatter rules when implementing, inspect bundle hashing of content-only packages,
current startup instruction transport, context injection preferences, and read-only filesystem
grant support. Confirm optional context selection cannot accidentally make delivery status lie.
