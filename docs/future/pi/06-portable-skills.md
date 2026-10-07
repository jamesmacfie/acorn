# Phase 06: portable plugin skills

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry: phase 05 accepted.
Next: [phase 07](./07-native-skills.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-06-portable-skills`, at the commit titled "Phase 06: Portable
plugin skills". [Skills](../../managed-agents/skills.md) is the owning contract.

- **Manifest.** `contributions.skills`, up to 16 entries of `{ id, path }`, in
  `packages/protocol/src/plugin/manifest/runtimeDescriptors.ts` and `contract.ts`. It's in the
  published schema (`packages/plugin-types/acorn-plugin.schema.json`) and the authoring type
  `PluginSkillDescriptor`. Skill IDs are their own namespace, and two that repeat fail the manifest.
  A skills-only package counts as node data (`contributesNodeData`), so it runs as a plugin with an
  empty `init` and no bundle.
- **Checks.** `packages/node-core/src/server/plugins/skills.ts` reads one skill. The folder must
  resolve inside the package and may hold no symlinks, at most 64 entries, 4 levels, and 1 MiB.
  `SKILL.md` must be UTF-8 with frontmatter. `name` follows Anthropic's published rule (up to 64
  lower-case letters, digits, and dashes). `description` is up to 1,024 characters with no XML tags
  and no control or bidirectional characters. The body is at most 64 KiB. The installer and the
  loader both run it, and a failure refuses the package with a named reason. The reader loads only
  when a package declares skills.
- **Digest and approval.** Each skill's digest is a sha256 over every file in its folder. The roster
  row carries `skills`: name, title, description, digest, approved, and enabled. An unapproved skill
  puts a request in the trust prompt on both hosts. Its one line, under **Declared** and not high,
  reads "Adds 1 procedure your agents can load: release-note", and its key holds every digest.
  `POST /v1/core/plugins/:id/skill-grant` records the digests shown, and answers 409 when they
  aren't the running plugin's. The answers live in `skill-state.json` in the data root
  (`server/plugins/skillState.ts`): `approved` by name, and `disabled` separately. Uninstall
  forgets both.
- **Catalogue.** `server/pluginHost/skills.ts` holds what each active plugin loaded, through a
  host-only `ctx.skills.register` that reload stages and teardown undoes. It also holds which harness
  last received each skill. The contract agents consumes is `deliverableSkills(dataDir)` and
  `recordSkillDelivery(harness, report)` on the compiled-only `@acorn/plugin-api/node`.
- **Delivery.** `plugins/agents/src/server/drivers/skillIndex.ts` builds the index: acorn's fixed
  sentence, then name, one-line description, and absolute `SKILL.md` path per skill, capped at 16 KiB
  with whole skills left out and counted. `ProviderSessionLifecycle` reads it at every start and
  resume and sends it as a `context.skills` part ahead of the first turn after the start, on every
  harness. A session that last received an index and now has none gets a withdrawal sentence. The
  session row keeps the last index's digest in `config.skillIndex`, a Node-only key. A delivery
  counts once that turn has run, and the transcript gets one info line naming what was sent.
- **Read access.** Claude gets a read-only allow rule per indexed folder, `Read(//<folder>/**)`, in
  the SDK flag settings. Codex and the ACP harnesses get no grant (see the matrix below).
- **Settings.** A **Skills** section on **Settings > Plugins > {plugin} > Overview**, with a switch per
  skill, its status (ready, off, waiting for approval, changed on disk), and the harnesses it reached.
  `GET` and `PUT /v1/core/plugins/:id/skills`, device-only and unmappable from a frame. **What it
  adds** counts skills. The terminal client answers a skills-only trust request itself.
- **Package.** [`packages/skills/`](./packages/skills/README.md), `pi-skills` 0.1.0: one skill,
  `release-note`, and a supporting `format.md` whose fixed last line shows the agent read it.

No migration. The wire changes are additive: `NodePluginRow.skills`, two routes, and two audit verbs,
`plugins.skills.granted` and `plugins.skills.switched`.

**Decisions and deviations.**

- **The design's trust claim was wrong.** It said a skill's bytes were "already covered by the bundle
  hash the device checks". The device hash covers only a client bundle, and a manifest-only package
  never reaches the bundle prompt. Skills are approved on the Node by digest instead, following the
  derived-source input grants.
- **No system prompt for the index.** The first build appended it to Claude's system prompt. On the
  real host a switched-off skill was still listed after a resume. Claude Code 2.1.292 keeps the
  appended prompt a session was created with and ignores a new one on `--resume`. Two direct CLI
  runs showed it: a resumed session kept `PINEAPPLE` and ignored a new `MANGO`. So the index goes
  ahead of a turn, the same way on every harness, and Codex's `developerInstructions` aren't used
  for it either. The cost is the index's tokens once per process start, and a compaction can drop
  it until the next start.
- **No staging copy.** The agent reads the installed package's folder. The digest check at every
  start guards it: a folder edited under a running Node reads as `changed` and isn't offered.
- **No symlinks in a skill folder at all,** rather than only escaping ones, so every file an agent
  opens was hashed.
- **Reserved words aren't refused.** Anthropic's API rejects `anthropic` and `claude` in a name, and
  Claude Code's local skills don't. The host follows Claude Code.
- **Medium is an ordinary line.** The trust line has two weights, high and not. A skill line isn't
  high.
- **The service boot budget rose to 3,144,500 B.** The branch head measured 3,129,438 B before this
  phase, already over the 3,127,500 B ceiling after the last merge from main. This phase measures
  3,143,980 B. The reader and the index builder load on first use. The rest is the manifest kind,
  the catalogue, the roster projection, the state file, three routes, and the delivery report.

**Harness matrix.**

| Harness | Index | Body read | Evidence |
| --- | --- | --- | --- |
| Claude Code 2.1.292 | Context part before the first turn after each start | Read-only allow rule per folder | Real host, below |
| Codex 0.159.2 | Same part, rendered by the Codex driver's context block | Built-in profiles read the whole disk; a custom profile that limits reads makes Codex ask | App-server schema only. Its account is at its usage limit until 2026-10-10 |
| DeepSeek, `omp` | Same part, as an `<acorn-context>` block | The harness's own tools. `omp`'s native `read` asks no permission (phase 01) | Neither is installed on this machine |

**Verification.**

- `pnpm lint` passes. `@acorn/arch-tests`: 86 passed, with the surface pin regenerated for
  `PluginSkillDescriptor`. `apps/node` `pnpm build` passes the budget.
- `skills.test.ts` (node-core), 9 cases: the standard shape with other keys ignored, a supporting
  file changing the digest, quoted and block descriptions, traversal and a symlinked folder, a
  symlink inside the folder, seven malformed frontmatter forms, the 1,024-character and 64 KiB
  bounds, duplicate IDs, deliverable only when approved, on, and unchanged, and a delivery recorded
  against the copy delivered. `loader.test.ts` loads a skills-only package as a node plugin and fails
  a broken skill by name. `plugins.test.ts` covers the roster row, a stale or partial grant
  refused with 409, the switch, and 404 for a plugin with none.
- `runtime.test.ts`: the index rides ahead of the first turn and not the second, Claude's folders are
  passed, the delivery is recorded, and after a switch-off and restart the next start sends the
  withdrawal. `skillIndex.test.ts` covers the bound and the omission count. `contextBlock.test.ts`
  covers Claude's grant with the index kept out of the system prompt.
- `trustModel.test.ts` and `distributionModel.test.ts`: one declared line, the line marked new when
  a digest changed, the grant posting the digests shown, and a node-only request for skills alone.
- Suites: `@acorn/plugin-agents` 1,151 passed. `@acorn/node-core` under Node 26.8.1: 1,624 passed,
  and the 3 failures are `storage/backup.test.ts`, whose 12 tests pass on Node 24.11.
  `@acorn/client-core`: 2,459 passed, with the known `scopes.test.ts` (`workspaceProjectOrderRoute`)
  and `cssHygiene` box-shadow failures. Both new routes are classified. `@acorn/protocol` 294,
  `acorn-plugin-types` 5, `@acorn/tui` 676, `@acorn/plugin-api` 14 after the facade snapshot update.
  `@acorn/node`: 272 passed, and `routeRegistry.test.ts` fails on a terminal plugin route,
  `POST /v1/p/terminal/tasks/:taskId/setup`, that this phase didn't add. The full `pnpm test` wasn't
  run.

Real host, `pnpm dev:agent -- --session pi-phase-06`, Claude Code 2.1.292 through ACP, Opus 5.5:

- The package installed through `POST /v1/core/plugins/install` and was `active` after a Node restart,
  with no bundle. The desktop trust prompt read "Approve this plugin's skills" and "Adds 1 procedure
  your agents can load: release-note" (`screenshot-1791338870828.png`). Accepting wrote the digest to
  `skill-state.json`.
- In a throwaway repository, a fresh session asked for "a release note for the uncommitted change"
  without naming the skill. The transcript says "Skills the agent can load:
  pi-skills:release-note.", the agent read `SKILL.md` and `format.md`, and its note ends with the
  fixed line from `format.md`. The repository's status showed only the seeded change.
- The settings page showed the switch and "Reached Claude Code at 03:08 PM"
  (`screenshot-1791338996035.png`). After the switch was turned off in the UI and the Node
  restarted, the resumed session answered that no procedures were available and earlier lists no
  longer applied. The transcript says "The agent was told no skills are available now."
  (`screenshot-1791340183075.png`).
- Editing `format.md` turned the status to `changed`, and restoring it turned it back to `ready`.
- In **Don't Ask** mode, `Read` on `SKILL.md`, outside the working directory, succeeded, and `Read` on
  `/etc/hosts` was denied, so the grant covers the skill folder only.
- Terminal client, `pnpm dev:tui:agent -- --session pi-phase-06-tui` with the package placed in its
  data root: the prompt "Run pi-skills?" showed the same line under **Declared** at 80 by 24, and
  **Run it** wrote the approval to that Node's `skill-state.json`. The client was resized to 120 by
  40 afterwards.
- Screenshots are in the session's ignored `.acorn/agent-dev/pi-phase-06/screenshots/`.

**Limitations.**

- **Codex, DeepSeek, and `omp` weren't run.** Codex is at its usage limit until 2026-10-10, and
  `dsh` and `omp` aren't installed. Their delivery is the shared context part, which the runtime
  test covers at the driver boundary.
- **Node switching wasn't exercised.** The session had one Node. Delivery reads only the Node's own
  catalogue and state, and the settings section is hidden for another Node.
- **The terminal client has no skills settings.** Its plugin pages open in the desktop app.
- **A first-turn read in the default `auto` mode went through Bash `cat`,** which Claude Code treats
  as read-only. The allow rule was proven separately in **Don't Ask** mode.
- **A Claude session created before this change** keeps any index it got in its system prompt, but
  no released build ever sent one.

**For phase 07.** Consume `deliverableSkills` and the catalogue rather than a second registry. Native
Claude delivery has to account for the same finding: the appended prompt and probably other session
options are fixed at creation, so check what a resumed session actually loads before claiming native
skills refresh. Keep `skillIndex.ts`'s portable part for any skill a harness didn't take natively,
and use the session's `config.skillIndex` digest to decide when a withdrawal is owed. Native names
map back to `<pluginId>:<id>`.

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
