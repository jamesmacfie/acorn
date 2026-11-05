# Phase 2: untrusted projects

Date: November 6, 2026. Status: landed, except the `dev:agent` checkpoint and the boot budget. Must
land before phase 3.

## Completion note

November 6, 2026. Each project is trusted or untrusted, and a URL clone starts untrusted. Until the
owner trusts it, nothing its repository ships runs on the Node. [Projects and
workspaces](../../workspaces-and-tasks/projects.md#untrusted-projects) owns the contract. [Project
configuration](../../workspaces-and-tasks/project-config.md#trust),
[Harnesses](../../managed-agents/harnesses.md#in-an-untrusted-project), [security
diagnostics](../../security/security-diagnostics.md), [Clone a Git
URL](../../workspaces-and-tasks/clone-runs.md), and the core route table cover their parts.

What landed:

- `projects.trusted`, default true, in migration `0017_project_trust.sql`. `ProjectRef`, the plugin
  `ProjectRef`, and the protocol `Project` carry it as an optional field. `POST
  /v1/core/projects/clone-runs` passes `trusted: false`, and a row that already named the empty
  target folder is marked untrusted too. Folder adds, `project add`, and importer clones stay trusted.
- `POST /v1/core/projects/:id/trust`, device only, answers `{ ok: true }` and publishes
  `project:changed`. `trustProject` in `projectTrust.ts` loads on first use.
- Setup: `projectSetup` reads an untrusted project as trigger `off`, `recordSetupDecision` records
  `skipped`/`disabled`, and a run by hand is refused with code `untrusted`.
- Committed config: `taskRunConfig`, the worktree `copy` step, the database URL sources, and the
  settings page's `repoConfig` all leave out the committed `.acorn/config.toml` layer.
- Committed workflows: `authorizeRepoWorkflow` wraps every `authorizeRepoConfig` the workflows plugin
  wires (start service, runner, dispatcher), and `authorizeProjectWorkflow` wraps the trigger check.
  Both throw `WorkflowAuthorityError('untrusted')` before core's config review. The task's workflow
  list leaves committed files out and adds one row saying why. The rules live in
  `repoWorkflowTrust.ts`, loaded on first use.
- Agents: `untrustedArgs` on `AgentProfileContribution`, which Claude Code sets to
  `--setting-sources user --strict-mcp-config`. `untrustedLaunchArgs` in core puts them first or
  throws the refusal. Applied to the interactive terminal, the terminal handoff, and a workflow step's
  headless and one-shot fallback. Managed sessions: `AgentDriver.untrusted` and
  `HarnessLaunchSpec.untrusted`, read at every start in `ProviderSessionLifecycle.start`. Claude gets
  `settingSources: ['user']` and `strictMcpConfig: true`, the data-folder block is forced on, and the
  instructions start with the untrusted line. Any other driver is refused.
- **Check this node** adds `projects.untrusted`: the count, and the harnesses that can run there.
- Client: an **Untrusted** section with **Trust this project…** at the top of the project's General
  tab, and a shield marker on the task's rail row.

Decisions and deviations:

- **Codex is refused.** Codex loads a project's `.codex/config.toml` only for a path its own trust
  list marks trusted, and says so for a path marked untrusted. `project_doc_max_bytes=0` is a real key.
  Acorn couldn't prove a `-c projects."<path>".trust_level` override matches the path Codex resolves
  for a worktree, so a half lock-down wasn't worth the risk. The phase doc allowed this.
- **Trust is read at every start, not fixed per session.** Trust is one-way, so a session that starts
  again after a trust change can only gain the owner's consent. That is what the read block does too,
  and it needs no stored session field.
- **One profile field, not `HeadlessOpts.untrusted`.** `untrustedArgs` covers interactive, headless,
  and one-shot launches, and its absence is the refusal, so a profile can't lock down one path and
  forget another.
- **The skip reason is `disabled`.** `taskScriptStateSchema` is a `z.enum`, and the client parses the
  status with it, so a new reason would break an older client. The project's `trusted` says why.
- **A locked-down terminal has no Acorn MCP tools.** Acorn registers its server for interactive Claude
  in the user's config, and `--strict-mcp-config` drops it. Managed sessions and the handoff pass
  Acorn's server explicitly and keep it. Passing it as `--mcp-config` on a terminal launch is a
  follow-up.
- **The data-folder block reaches managed sessions only.** Terminals and headless steps never had the
  block's plumbing. A Claude workflow step runs managed unless the agents plugin is off.
- **The trust route answers `{ ok: true }`**, not the project, because the client refetches anyway and
  the route sits in the boot graph.
- **The Docker plugin's `[docker]` table still reads.** It holds container name hints and runs nothing.
- **The rail marker stands in for "the task chrome says so"**, because the task chrome shows no setup
  reason anywhere else.

Verify before building, answered:

- With `--setting-sources user`, Claude Code 2.1.318 loads neither the checkout's `.claude/settings.json`
  hooks nor its `CLAUDE.md`. A throwaway repository with a `SessionStart` hook that touches a marker
  and a `CLAUDE.md` that asks for a code word: without the flags, the marker appeared and the reply
  had the code word. With `--setting-sources user --strict-mcp-config`, neither. The SDK's own
  documentation says `'project'` must be in `settingSources` to load `CLAUDE.md`, and `.claude/skills`
  is a project source too.
- The SDK option is `strictMcpConfig`, which maps to `--strict-mcp-config`. `claude-agent-acp` 0.54.1
  spreads `_meta.claudeCode.options` over its own defaults, so `settingSources` replaces its
  `['user', 'project', 'local']`.
- Codex: see the deviation above.
- A new skip reason would break older clients: see the deviation above.

For later phases:

- Phase 3 can ship. The clone route writes untrusted projects, and the settings page can trust them.
- Phase 4's importers keep `trusted` unset, which reads as trusted. `ProjectCloneInput.trusted` is
  core-only, so a plugin can't pass it.
- Phase 5's post-clone run must name a user or database workflow. A `repo:` one is refused in an
  untrusted project, and the picker shouldn't offer one.
- A new launch path must check trust. The terminal, the handoff, the headless fallback, and the
  managed lifecycle are the four. A test that lists every launch entry point wasn't written.
- Site pages that cite the changed docs weren't touched, as in phase 1.

## What's left

- **The boot budget is over.** The Node service's boot graph is 1,948,408 bytes against the
  1,947,000-byte ceiling, 1,979 bytes over the 1,946,429 it was before this phase. The trust rules,
  messages, and lock-down helpers load on first use. What stays is a trust check and an import at each
  of about 20 sites. Fitting it means moving unrelated code out of the boot graph, or raising the
  ceiling to about 1,950,500 by the script's "figure plus about 2 KB" rule. That decision is the
  coordinator's.
- **Checkpoint, partly run.** The `dev:agent` walk with a managed Claude session wasn't run. The CLI
  check above covers the same Claude flags the terminal and headless paths use. The managed path's
  options are covered by unit tests and by reading the adapter. Run the walk by hand and record it
  here.

## Risks still open

- **Prompt injection isn't solved.** The agent still reads files an attacker wrote. The lock-down stops
  the repository configuring the agent, and the read block and the harness's permission mode are the
  remaining limits.
- **A terminal command line you type isn't locked down.** That is your own command, by design.
