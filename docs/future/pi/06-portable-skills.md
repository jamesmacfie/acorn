# Phase 06: portable plugin skills

Status: proposed, 2026-10-03. Entry: phase 05 accepted. Next:
[phase 07](./07-native-skills.md).

## Outcome

A manifest-only loaded plugin supplies named procedures to supported managed harnesses. The agent
sees names, descriptions, and readable body locations; it loads a body only when needed. A settings
row explains which harnesses receive each enabled skill.

## Design

The design as proposed on 2026-10-02. The implementation steps below refine it and win where they differ.

### Why

An `omp` plugin is a folder that can hold skills, slash commands, rules, prompts, subagent
definitions, MCP servers, and language-server setups, in a format shared with Claude Code's plugin
marketplace. Most useful plugins in that ecosystem are content, not code: a review checklist, a
migration procedure, a house style. They are text an agent reads when the task calls for it.

An acorn plugin can contribute instructions three ways: a custom agent's system prompt text, a context
section, and an agent context in the launch tray. All three put text in front of the agent up front.
None of them is a skill: a named procedure the agent sees only by name and description until it
decides to load the body. That difference matters at scale. Ten skills cost ten lines of context; ten
context sections cost their whole bodies on every session.

Acorn already reads skills from harnesses. Codex's `skills/list` fills `AgentSkillDescriptor` in
`plugins/agents/src/contract/wire.ts`, and the composer offers them after `$`
([client surfaces](../../managed-agents/client-surfaces.md)). What acorn cannot do is supply one.

This is also where acorn can beat `omp`. An `omp` skill reaches `omp`. An acorn skill could reach
Claude, Codex, DeepSeek, `omp`, and any contributed harness from one manifest, the way an MCP server
added in Settings reaches all of them.

### What a skill is

A folder holding a `SKILL.md` file: YAML frontmatter with `name` and `description`, then a Markdown
body, with optional supporting files beside it. Claude Code reads this shape from `.claude/skills/`,
and Codex reads a compatible one. Use the shape as published, with no acorn additions, so a skill
written for Claude Code drops into an acorn plugin unchanged.

### The shape

#### The manifest

```json
{
  "contributions": {
    "skills": [
      { "id": "review-checklist", "path": "skills/review-checklist" }
    ]
  }
}
```

The host resolves `path` inside the contributing package, the same way it resolves a harness's
`spawn.entry`, and refuses a path that leaves the package. It reads `SKILL.md`, checks the frontmatter,
caps the description at 1,024 characters and the body at 64 KiB, and refuses the contribution with a
named reason when either fails. The skill's runtime name is `<pluginId>:<id>`, minted by the host.

No node or client bundle is needed. A skills-only plugin is a manifest and folders, like a data-only
harness.

#### Delivery, in two layers

**Layer 1, every harness: an index plus a readable path.** This is how skills already work inside
Claude Code: the agent sees each skill's name and description, and reads the body when it needs it.
Acorn can do the same for any harness without the harness knowing what a skill is.

- Add one context section owned by the agents plugin, `skills`, that lists each enabled skill as name,
  description, and the absolute path of its `SKILL.md` in the installed package.
- Add one sentence above the list: "These are procedures you can load. Read the file when a task
  matches the description."
- Deliver it on every start and resume, the same rule MCP servers follow, so enabling or disabling a
  plugin takes effect on the next resume.

The path has to be readable by the agent. The installed package sits under acorn's data root, outside
the worktree. Check each harness: Claude Code may ask before reading outside its working directories,
which the Agent SDK's additional-directories option can grant for that one folder; Codex's sandbox
policy decides for Codex. A harness that cannot read the path gets no index, and the skill's settings
row says which harnesses received it.

**Layer 2, where a harness has a native door.** Native delivery gives the person `$skill` and `/skill`
in the composer and lets the harness's own skill tool load it.

- **Claude Code.** The Agent SDK accepts local plugin folders. Acorn already passes SDK options through
  `_meta.claudeCode.options` in `plugins/agents/src/server/drivers/claudeHarness.ts`. Generate one
  plugin folder per session under the data root holding the enabled skills, and pass it there. Never
  write into the worktree's `.claude/skills`, which would show up in the person's git status.
- **Codex.** Find whether the app-server takes extra skill roots on `thread/start`, or a config key
  that does. If the only door is `CODEX_HOME`, do not use it: moving it moves Codex's login.
- **Generic ACP.** No protocol door. Layer 1 covers them.

When a harness receives a skill natively, leave it out of that session's layer 1 index so the agent
does not see it twice.

#### Trust

A skill is text that tells an agent what to do, so it is a prompt-injection path by design. Disclose it
in the trust prompt as a medium line: "Adds 3 procedures your agents can load", with the names. The
bytes are already covered by the bundle hash the device checks, so an update that changes a skill's
body asks again like any other change.

#### Settings

**Settings > Plugins > {plugin}** lists the plugin's skills, each with a switch and the harnesses it
reached. Disabling one removes it at the next start or resume.

### What this leaves out, and why

- **Rules.** `omp` rules can apply by file glob or interrupt a stream. A glob-scoped rule needs the
  harness to tell acorn which file it is about to edit, and stream rules need the loop. An always-on
  rule is a context section, which a plugin can contribute today.
- **Slash commands.** Claude Code treats a command as a skill with a slash name. Layer 2 gives Claude
  commands for free. A command for every harness would be a composer feature that expands a template
  before sending, which `agents:before-send` with `transform` can already do.
- **Subagent definitions.** These are custom agents, which a plugin can contribute today
  ([managed-agents.md § From a plugin](../../managed-agents/custom-agents.md#from-a-plugin)).
- **Hooks.** Claude Code plugin hooks run shell commands inside Claude only. They are code, and they
  belong to the harness's trust model, not acorn's.

### Later: Claude Code plugin folders

Most published skills ship inside Claude Code plugin folders: `.claude-plugin/plugin.json` beside
`skills/`, `commands/`, `agents/`, and `.mcp.json`. Once phases 06 and 07 ship, an importer could install
such a folder as an acorn content plugin: skills as skills, agents as custom agents, `.mcp.json`
entries as MCP servers, and hooks refused with a visible reason. Discovery from a marketplace catalog
belongs to [ecosystem](../ecosystem/README.md), which waits on signing.

Trigger: a person asks to use a published Claude Code plugin in Codex or another harness. In Claude
sessions it already works, because Claude loads its own plugins.

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

Update [manifest authoring](../../plugin-authoring/the-manifest.md),
[contribution kinds](../../contribution-kinds.md), [managed agents](../../managed-agents.md),
[security](../../security.md), and [state ownership](../../state-ownership.md).
Record the public catalogue/delivery contract, trust-hash coverage, portable per-harness matrix,
staging lifetime, and consumer package. Phase 07 consumes that contract rather than inventing a
second skill registry.

## Verify before building

Read official frontmatter rules when implementing, inspect bundle hashing of content-only packages,
current startup instruction transport, context injection preferences, and read-only filesystem
grant support. Confirm optional context selection cannot accidentally make delivery status lie.

From the design:

- The Agent SDK's option name for local plugin folders and additional readable directories, and that
  the Claude ACP adapter passes `_meta.claudeCode.options` through for both.
- Codex's skill roots and whether `skills/list` takes anything beyond `cwds`.
- How MCP servers are delivered on start and resume in `plugins/agents/src/server/sessions/runtimeEngine.ts`,
  to reuse the same path for the index.
- The current `SKILL.md` frontmatter rules, from Anthropic's documentation rather than from memory.
