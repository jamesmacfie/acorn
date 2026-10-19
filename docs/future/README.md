# Future implementation handoffs

Reviewed October 12, 2026. This folder holds proposed work and acceptance that remains open.
Use the linked entry page to identify the next task, its prerequisites, and its completion checks.
Shipped contracts belong in reference pages under `docs/`; those pages win if a plan disagrees.

A proposal is not a scheduled task. Recheck its dated starting point against the target checkout
before implementation. Keep scope, authority, stored data, and acceptance requirements explicit.
Dated delivery evidence belongs in `docs/testing/` or the dated security reviews.

## The programmes

| Folder | Developer handoff | Status |
| --- | --- | --- |
| [agent-analytics/](./agent-analytics/README.md) | Eight phases toward a workspace view of agent time, spend, and struggle: dynamic UI fitted for plugin regions, facts for each finished turn, agent turn and session sources, heatmaps and stacked bars, workspace-scoped rail sources, session marks, links to a message, and the `acorn-analytics` plugin in its own repository. | Proposed October 19, 2026. Assumes dynamic UI has merged. Implementation not started. |
| [cloud/](./cloud/README.md) | Eleven phases for hosted Nodes, accounts, relay, workers, archives, isolation, policy, teams, and billing. | Proposed. Enrollment and provider contracts are implemented foundations; hosted services remain unbuilt. |
| [ecosystem/](./ecosystem/README.md) | Design package attestation, implement verification, then build discovery over verified packages. | Authoring, reload, and worker isolation implemented. Signing and discovery remain proposed. |
| [dynamic-ui/](./dynamic-ui/README.md) | Eight phases for agent-built UI: dashboard panels an agent drafts in the conversation and the owner adds to a dashboard, then a Solid renderer for OpenUI, a spike, and apps written in OpenUI Lang over dashboard plans, with project publishing, apps on dashboards, turning an app into a plugin, and team use. | Proposed October 1, 2026, and revised October 19, 2026 for agent-made panels, OpenUI Lang, and plans. Phases 1 to 7 built October 19 and 20, 2026, and their phase files removed. Phase 8 waits on the cloud programme. |
| [marketing/](./marketing/20-launch.md) | Launching the public website at `acorn.sh`: the content review, walks with published packages, quality checks, DNS, and deploy. `docs/site.md` documents the site. | Phases 1 to 19 done October 16, 2026. Launch not started. |
| [mobile/](./mobile/README.md) | Six phases to a mobile web app: a gateway that gives a phone a session, a phone-shaped shell over client-core, a narrow mode switched from the root element, narrow layouts, **Needs you** and the agent conversation, and acceptance on real phones. | Proposed October 17, 2026. Implementation not started. |
| [node-tray/](./node-tray/README.md) | Eight phases to run a Node for clients on other machines: the device token out of logs, pairing and stopping from the terminal, choosing who can reach the Node, platform archives built by GitHub Actions, an installer and login service per operating system, desktop tray mode, keeping the machine awake, and acceptance on real machines. | Phases 1 to 7 landed October 18, 2026, on macOS. Plans for phases 1 to 3 removed October 20, 2026. Phase 8, acceptance on real machines, remains open. |
| [split/](./split/README.md) | Ten phases that fix drift in the Node and client split and the core and plugin split, including forge-neutral repositories and change requests. | Phases 1 to 9 implemented October 15, 2026, and the plans for 1 to 8 removed October 20, 2026. Phase 10, the remote preview proxy, is proposed. |
| [tui-review/](./tui-review/README.md) | Finish terminal forms, feature journeys, host comparison, and packaged acceptance. | Startup, text controls, setup, Settings routing, files, promotion, and PTY paths implemented. Broader acceptance remains open. |

## The single files

| File | Developer handoff | Status |
| --- | --- | --- |
| [acorn-sentry.md](./acorn-sentry.md) | Send opted-in errors and sampled traces from release builds to the acorn team's Sentry: a DSN injected at build time, a second consent switch, defaults sized for many installs, a filter that keeps only core and unmodified official plugins, and source map upload. Also lists the other release secrets. | Proposed October 17, 2026. Implementation not started. |
| [bundle.md](./bundle.md) | Container coordination, desktop TUI embedding, and macOS signing. Platform archives, Windows operation support, and the installer belong to [node-tray/](./node-tray/README.md). | Standalone CLI/TUI staging and certificate generation implemented. Release delivery remains proposed. |
| [compiled-tier.md](./compiled-tier.md) | Assess plugin migration candidates, reproduce retained cleanup reports, and finish loaded-package acceptance. | Standing assessment refreshed October 8, 2026. No migration scheduled. |
| [dashboards-gaps.md](./dashboards-gaps.md) | Filter diagnostics, AI preview/review controls, and the GitHub branch-source decision. | Followups to the implemented studio and derived sources. Replaces the completed phase plans. |
| [extension-docker-panel.md](./extension-docker-panel.md) | A read-only Docker panel in the browser extension's sidebar: the task's containers, ports, and logs. | Implemented October 16, 2026. The real-browser check remains open. |
| [extension-github-panel.md](./extension-github-panel.md) | Let built-in plugins declare a browser extension panel, then a read-only panel for the task's pull request state, checks, and reviews. | Implemented October 16, 2026. The check in a real browser remains open. |
| [integration-ideas.md](./integration-ideas.md) | Research catalogue for selecting integrations and checking contribution coverage. | Research, not an implementation specification. Recheck each candidate before assigning work. |
| [kimi.md](./kimi.md) | An external Kimi harness package and optional usage/auth probes. | Proposed. No Kimi implementation in this checkout. Other external harnesses already exercise the contribution contract. |
| [mcp-sign-in.md](./mcp-sign-in.md) | Sign in to a remote MCP server once per Node from Settings → MCP. The Node keeps and refreshes the tokens, and sessions on every account reach the server through a relay. | Implemented October 16, 2026. The checks against real servers (Sentry, Codex, and `pnpm dev:remote`) remain open. |
| [opencode.md](./opencode.md) | An external OpenCode harness package beside Claude Code and Codex, through `opencode acp`. | Postponed October 19, 2026, until OpenCode is installed and signed in. The tool result cap, memory change notes, and `run_script` from the same review were implemented October 19, 2026. |
| [performance-spans.md](./performance-spans.md) | Slow-call child spans on the Node, sleep and hidden-window marks, and spans for tool availability, plan usage, archiving, the repository lock, host load, and outbound APIs. | Implemented October 16, 2026. The day of Sentry acceptance queries remains open. |
| [rail-palette-openers.md](./rail-palette-openers.md) | An **Open <label>** palette row for every left rail source, each with a shortcut that's unbound until the person sets one. The host owns every opener, and GitHub's `⌘0` goes away. | Implemented October 19, 2026. The check on a second Node without Docker remains open. |
| [remote.md](./remote.md) | Browser auth, transport, custody, multiple Nodes, and a mobile progressive web app. | Host foundations implemented. Browser and mobile clients remain proposed; Cloud owns the relay. |
| [split.md](./split.md) | Extract loaded plugins and the authoring toolkit with packed-artifact compatibility and host seeding. | Published authoring packages implemented. Repository extraction remains proposed. |
| [workflows-gaps.md](./workflows-gaps.md) | Assess graph navigation, prompt display, retry safety, agent control, and file triggers. | Proposed gaps. Confirm each against Workflows before implementation. |

## Choose the owning plan

Dashboard followups do not require rebuilding the studio. Node packaging and repository extraction
can proceed beside plugin signing; discovery depends on accepted package verification. Cloud owns
relay order and account identity.

## Completed plans removed

These plans remain in Git history. Use their reference owners for implemented behavior:

| Removed plan | Owner or remaining handoff |
| --- | --- |
| `github/`, removed October 20, 2026 | [Code hosts](../plugins/code-hosts.md), [self-hosted code hosts](../plugins/self-hosted-code-hosts.md), [GitHub](../github-integration.md), [GitLab](../gitlab-integration.md), and [Bitbucket](../bitbucket-integration.md). Open acceptance: GitLab and Bitbucket were checked against fake APIs only, and fork checkout against local repositories over file URLs only. A check with real accounts remains. |
| `context-references.md`, removed October 20, 2026 | [The composer § Reference Acorn context](../managed-agents/composer.md#reference-acorn-context) and [agent contexts](../plugins/more-descriptors.md#agent-contexts). Open checks are in [the October 19 walk](../testing/context-references-2026-10-19.md#not-checked-here): `#http` and `#db` in the terminal client, and **Done** returning focus there. |
| `extension-ux/`, removed October 19, 2026 | [The browser extension](../browser-extension.md) and its pages, such as [navigation](../browser-extension/navigation.md), [task pages](../browser-extension/task-pages.md), [the Needs you list](../browser-extension/notifications.md#the-needs-you-list), and [plugin panels](../browser-extension/plugin-panels.md). Phase 13, a **Context** picker in the composer, was skipped. Never done: a shared panel renderer for the desktop or terminal, the agents plugin's own parts in the sidebar, the kit's `StatusDot` and fields for the sidebar's last plain ones, and a severity per line on a panel's `status` block. A later commit brought back the bottom rail for a task's panes. |
| `perf/`, removed October 19, 2026 | [Node boot](../telemetry/node-boot.md), [profiling](../local-development/profiling.md), [boot order](../node-distribution.md#boot-order), [managed sessions](../managed-agents/sessions.md), and [worktrees](../workspaces-and-tasks/worktrees.md). Never done: the release-build baseline and its comparison, and the keychain, first-launch scan, and renderer fetch checks the shell's `[shell:boot]` lines exist for. |
| `usage-ui.md`, removed October 16, 2026 | [Harness accounts § Plan usage](../managed-agents/accounts.md#plan-usage) and [providers § Plan usage](../managed-agents/providers.md#plan-usage). Open acceptance: a real-window check with two signed-in Claude Code accounts. The small bars on account rows follow the account name, because a fold's `meta` slot sits right after its label, so they line up across rows only when the names are the same length. |
| `element-picker/`, removed October 14, 2026 | [Ask Acorn about an element](../browser-extension/element-picker.md), which lists what wasn't checked in a browser. |
| `ui-performance/`, phases 01 to 05 removed October 13, 2026, and the rest October 14, 2026 | [Streaming replay](../local-development/streaming-replay.md), [Markdown renders block by block](../ui-design/kit-internals.md#markdown-renders-block-by-block), [idle stop](../managed-agents/operations.md#idle-stop), and [diagnosis](../telemetry/diagnosis.md). Open acceptance: the [checks still to run](../testing/ui-performance-open-checks-2026-10-14.md). |
| `steering.md`, removed October 13, 2026 | [Steer a running turn](../managed-agents/steering.md). Open acceptance: a real-window Node kill between the harness taking a steer and the Node recording it. |
| `agent-search-startup.md`, removed October 13, 2026 | [Transcript search](../managed-agents/transcript-search.md). |
| `editor-line-blame.md`, removed October 13, 2026 | [Line annotations](../editor/line-annotations.md), which lists the open questions. |
| `spawned-agent-notes.md`, removed October 13, 2026 | [Notes in delegated agents](../notes-and-memory.md#notes-in-delegated-agents). [Managed delegation](../managed-agents/delegation.md#notes-in-delegated-agents) notes the open acceptance. |
| `multi-account.md`, removed October 12, 2026 | [Harness accounts](../managed-agents/accounts.md), which lists what didn't ship. |
| `lazy-plugin-code.md`, removed October 12, 2026 | [Load a route on first use](../plugin-authoring/the-node-half.md#load-a-route-on-first-use). |
| `task-deletion.md`, removed October 12, 2026 | [Deleting a task](../workspaces-and-tasks/archive.md#deleting-a-task). |
| `workflow-agent-goals.md`, removed October 12, 2026 | [Completion conditions](../workflows/agent-steps.md#completion-conditions). |
| `workflow-agent-tools.md`, removed October 12, 2026 | [Workflow tools](../agent-tools/workflow-tools.md). Open acceptance is in [workflow followups](./workflows-gaps.md#add-dedicated-agent-control-tools). |
| `group-projects-later.md`, removed October 8, 2026 | [Workspaces and tasks](../workspaces-and-tasks.md#workspace-and-project). |
| `find-in-file.md`, removed October 8, 2026 | [Find in a file](../editor.md#find-in-a-file). |
| `editor-files.md`, removed October 8, 2026 | [File renderers](../editor/file-renderers.md). The renderer catalogue and the rectangle design remain in Git history. |
| `workspace-icons.md`, removed October 8, 2026 | [Workspace icons](../workspaces-and-tasks/workspace-icons.md). |
| `test-feedback.md`, removed October 8, 2026 | [Testing](../testing.md). Broader excluded performance ideas remain in Git history, not assigned requirements. |
| `dashboards/`, removed October 8, 2026 | [Dashboard reference](../dashboards.md), [derived sources](../data-sources/derived-sources.md), and [remaining work](./dashboards-gaps.md). |
| Six Editor phase plans, removed October 8, 2026 | [Editor reference](../editor.md), [dated completion records](../testing/editor-delivery-2026-10-08.md), and [checks still to run](../testing/editor-phase06-follow-up-2026-10-08.md). |

## Retired folders

`cleanup/` shipped all seventeen proposals and was deleted on October 12, 2026. The reference
pages each proposal touched own the result: [mixed builds](../api-reference/versioning.md#mixed-builds) for the
version policy, [formatting](../local-development/formatting.md) for the formatter, and
[conventions](../conventions.md) for the comment and staleness rules. Each proposal's completion
note remains in Git history.

`deerflow/` shipped all five phases and was deleted on October 8, 2026.
[Composer](../managed-agents/composer.md), [turn operations](../managed-agents/operations.md),
[transcript search](../managed-agents/transcript-search.md),
[delegation](../managed-agents/delegation.md), and [workflow execution](../workflows/execution.md)
own the shipped behavior. The review, completed plans, deferred smaller ideas, and refused
alternatives remain in Git history.

`url/` was implemented, merged into main, and deleted on October 8, 2026.
[Acorn links](../frontend/acorn-links.md) owns the address forms, Copy link, task promotion,
desktop and terminal behavior, and the remaining installed-release verification gap. The phase
plans and verification records remain in Git history.

`project-workspace/` was implemented and deleted on October 8, 2026. [Workspaces and tasks](../workspaces-and-tasks.md)
owns the `core.workspaces` mode, and [projects and workspaces](../workspaces-and-tasks/projects.md)
owns the one-project rule and the first-run **Layout** step. Its refused alternatives and deferred
list remain in Git history. Later grouping is implemented; [workspaces and tasks](../workspaces-and-tasks.md#workspace-and-project) owns it.

`outdated-review-comments.md` was implemented and deleted on October 7, 2026.
[Review locations](../github-integration/mirror.md#review-locations) owns provider status, historical
locations, legacy handling, and revision compatibility. [Conversation](../github-integration/surfaces.md#conversation)
owns historical presentation. The proposal remains in Git history.

`sandbox/` was deleted on 2026-10-03. The local task-isolation proposal did not establish how to
preserve normal Git and host development workflows. The API gates, project configuration trust,
and loaded-plugin containment it recorded remain in [Security](../security.md). Cloud worker
isolation and team policy remain proposed in [cloud isolation](./cloud/isolation.md). The local
design and research remain in Git history.

`memory/` phases 1–3 were implemented on 2026-10-02, and the folder was deleted on 2026-10-03.
[Notes and memory](../notes-and-memory.md) owns direct writes, standing context, history, Undo, the
Memory page, and import. [Testing](../testing/memory.md#open-acceptance) retains the open harness
and usage checks. The proposed fourth phase moved to [cloud team memory](./cloud/memory.md). The
design, research, refused alternatives, and delivery records remain in Git history.

`client-plugins/` shipped its five phases in 2026-09 and was deleted on 2026-09-27.
[Plugins](../plugins.md), [security](../security.md), [frontend composition](../frontend.md),
[pane layout](../panes.md), [appearance](../ui-design/appearance.md), and
[terminal chrome](../tui/chrome.md) own the behavior. [remote.md](./remote.md)
owns browser custody. The parked icon-pack proposal and the refused alternatives remain in git history.

`cli/` shipped on 2026-09-27 and was deleted after final review. [CLI](../cli.md) owns command
grammar, output schemas, service lifecycle, and examples; [Node distribution](../node-distribution.md)
owns packaging; [API reference](../api-reference.md) owns the invocation route; and
[CLI command authoring](../plugin-authoring/cli-commands.md) owns the loaded-plugin descriptor.
The five-phase proposal and its refused alternatives remain in git history.

`rail-source-visibility.md` shipped on 2026-09-30 and was deleted. [Frontend](../frontend/rail-and-routing.md#rail-source-visibility)
owns the preference, the rail projection, and the palette opener; [the manifest](../plugin-authoring/the-manifest.md)
owns `showInRailByDefault` and `railSourceVisibility`; [activation](../plugins/activation.md#the-plugin-strip)
owns the plugin strip; and [testing](../testing.md) holds the manual checks.

`approval.md` shipped on 2026-09-29 and was deleted. [Workflow
execution](../workflows/execution.md#human-gates) owns the gate form's contract,
[workflows](../workflows.md) owns the run pane, [authoring](../workflows/authoring.md) owns the
inspector and generation, [security](../security.md) records that a gate answer is device-only, and
[API reference](../api-reference.md) owns the gate route. The manual check is part of item 52 in
[testing](../testing.md). The deferred rejection branch, rejection note, and tool-call gates remain
in git history.

`ui-consistency/` shipped its 20 fix batches by 2026-10-02 and was deleted. [UI design](../ui-design.md)
owns the help mark, tooltips, dialogs, states, and the heading levels; [the closed kit](../ui-design/closed-kit.md)
owns the `description` against `help` rule; and [frontend](../frontend.md) owns the page forms. The
house patterns, the deferred findings, and the open product decisions remain in git history.

`pi/` shipped its eleven phases on 2026-10-07 and was deleted. [Permission policy](../managed-agents/permission-policy.md),
[session messages](../managed-agents/session-messages.md),
[unattended follow-ups](../managed-agents/unattended-follow-ups.md), [skills](../managed-agents/skills.md),
[session control](../managed-agents/session-control.md), [loop hooks](../managed-agents/loop-hooks.md), and
[plugin model grants](../integrations/model-providers.md#plugin-model-grants) own its contracts. Its
consumer plugins moved to their own repositories: `acorn-permission-policy`, `acorn-advisor`,
`acorn-session-meter`, `acorn-skills`, and `acorn-omp-harness`. The phase records, including the dropped
resource-read experiment, remain in git history.

`phased-review-steps/`, `user-extensions/`, `node-first/`, `node/`, `acp/`, `tauri/`, `events/` and the later
`events.md` follow-up (shipped on 2026-09-11), `layout/`, `structure/`,
`structure-followup/`, `before-terminal-ui/`, `terminal/`, `terminal-updates/`, `terminal-rewrite/`,
`notifications/`, `git-inspired/`, and
the single files `live-qa.md`, `dx.md`, `web_search_run.md`, and `rail-tab.md` are in git history. The
rail component and compiled marker contract live in [ui-design.md](../ui-design.md), and loaded task
annotations live in
[Cooperative extension points](../plugins/rows-and-annotations.md#task-annotations). Each ended by saying
where its behaviour moved.

`node/` shipped on 2026-09-26. [Architecture overview](../architecture-overview.md) owns the
runtime-to-client data flow; [plugin activation](../plugins/activation.md) owns active versus installed
identity, per-Node selection, trust transitions, and availability; [descriptors](../plugins/descriptors.md)
and [shell](../shell.md) own per-tree bridge authority; [security](../security.md) and
[caching](../caching.md) own exact-hash custody; [testing](../testing.md) retains the multi-node and
multi-tree manual checks. The proposal's global winner terminology was replaced with selection from
each Node's running identity. No persisted trust, cache, layout, or plugin state was cleared.

`git-inspired/` was six phases of bounded large-surface rendering, after GitHub's 2026 account of
rendering a 2,200-file, million-line pull request: complete GitHub topology, segmented diff
documents, dynamic-block geometry, a resident segment cache, and bounded timelines. Shipped and
deleted 2026-09-27 on branch `large-render`. [diff-rendering.md](../diff-rendering.md) owns the
viewer: § The document, § The source port, § Data flow, § Parsing and highlighting, § Resident
segments, § Row geometry, and § What large-surface rendering refuses, which holds the eighteen
decisions. [github-integration.md](../github-integration.md) § Pull request detail and files has the
full walk, the stage-then-swap, the 3,000-file and 300-file ceilings, and the unconfirmed 250-commit
cap; § Diff documents has the descriptor blobs, the two repository routes, and the node-wide digest
limit; § Conversation has turn identity, near-viewport bodies, and snippets.
[client-surfaces.md](../managed-agents/client-surfaces.md) has the transcript's fixed window, why it
shipped, its three refusals including `content-visibility`, and its known limits.
[caching.md](../caching.md) has the digest-keyed blobs, the unpruned cache, and the resident cache;
[telemetry.md](../telemetry.md) § Rendered-surface health has the probes;
[state-ownership.md](../state-ownership.md) has the reading places and the per-node cache;
[api-reference.md](../api-reference.md) and [data-layer.md](../data-layer.md) have the routes and the
mirror columns; [package-shape.md](../plugins/package-shape.md) § The plugin API and
[plugin-authoring.md](../plugin-authoring.md) § Drawing a diff have plugin API major 2; and
[tui/scrolling.md](../tui/scrolling.md#the-diff-window) has the terminal's diff pane. The fixture and the flow are
[testing.md](../testing.md) § Large-surface fixture and
[local-development.md](../local-development.md) § Large-surface flow. Smoke items 81 to 85 in
[changes-and-large-surfaces.md](../testing/changes-and-large-surfaces.md) are the real-window acceptance it still owes: none has run on a visible
WebKit window.

`web_search_run.md` made a managed transcript show what an agent searched for, which pages it opened,
and which sources came back, the same way whichever harness ran it. Shipped and deleted 2026-09-15.
[managed-agents.md](../managed-agents.md) § Web activity owns the behaviour: the optional `web` payload
on a tool call and why it is not an event kind of its own, the per-driver mapping and the rule against
reading ACP's `kind`, the shared action-to-title table, the two live captures and the two things in
them that contradicted the proposal, the two layers of bounds and why overflow drops sources instead of
becoming an artifact, the `http`-and-`https`-only link rule, and what happens to rows recorded before
it. [testing.md](../testing.md) has the captures under managed-agent coverage and the manual pass as
item 70.

`ai-harness/` was six phases that gave acorn one "generate with" list over stored API keys and the
agent CLIs already on the machine, so someone holding `claude` or `codex` and no key stops seeing a
Generate control that is not there. Shipped and deleted 2026-09-09.
[integrations.md](../integrations.md) § Model providers owns the seam: what a backend is and why a CLI
is not a synthesized connection, the two required id prefixes,
the connections-first ordering the palette fast path and the silent fallback depend on, the probe on
every read with no cache, the dispatch on the prefix, the containment of a CLI generate, and the one
core read route beside the generate endpoint that is still refused.
[managed-agents.md](../managed-agents.md) § Harnesses has `aiArgv` as the whole code-tier opt-in,
`HeadlessOpts.system` and who joins it to the prompt, the catalog each profile declares or refuses,
and the two stream shapes, including the standing bug the programme found: Codex's stream was being
read with Claude's parser, so no Codex headless or `decide` turn had ever succeeded.
[plugin-authoring.md](../plugin-authoring.md) § Harnesses has the manifest `oneShot` block, the
OpenCode example and the two things to check before choosing `output`; § Permissions has what the one
`models` token does and does not decide; and [plugins.md](../plugins.md) § Harnesses has the second
trust line. [security.md](../security.md) § Credential handling has the rule that a harness spends the
CLI's own login and never a key acorn holds. [state-ownership.md](../state-ownership.md) § Scope rules
has the one `models.generatePick` default and the SQL dialog's known limit, which is the programme's
one unclosed deviation: that dialog is a remote tree in a worker and cannot read a device preference,
so it opens on the first backend and remembers nothing. [ui-design.md](../ui-design/closed-kit.md) § The closed
kit has the renamed picker, [features.md](../features.md) and
[first-party-plugins.md](../first-party-plugins.md) have the Settings section and the wizard step,
[api-reference.md](../api-reference.md) has the route, and
[workflows.md](../workflows.md) § What an agent step sees has `decide` on Codex and why a manifest
harness passes that check and then fails at run time. [agents-and-providers.md](../testing/agents-and-providers.md) holds everything the
programme owes: five manual checks, items 58 to 62, including the acceptance test that someone writes
the OpenCode plugin from the authoring doc alone. Its refusals are in git history, and the two worth
not re-arguing are a CLI as a synthesized connection row and a second `models:harness` permission
token.

`workflows/` was seven phases that turned a workflow engine nobody could see into one a person
authors and watches: steps that wait on named steps and run in parallel, declared inputs, step kinds
that describe their own form, definitions typed in the app, an editor, a run pane, and a start from a
tracker row. Shipped and deleted 2026-09-08.
[workflows.md](../workflows.md) owns most of it. § Execution model has the graph and its one
readiness rule, `decide` in a graph, inputs, isolation, what an agent step sees, and retry;
§ Database definitions has the two stores read as one list, the two trust stories, save to repo and
what a row may name; § Authoring has the rail source, the editor's three kinds of row, the draft
rules, the graph view, the JSON tab and where positions live; § Contributed step kinds has `describe`,
the closed field vocabulary and the catalog route; § Routes and UI has the pane, the per-kind detail
and the three frames it listens to; § Starting a run from an item has the flow and the prefill rule;
and § What workflows refuses has the twenty-two decisions, from a separate `edges` list to a second
run list.

The rest went to the contract's owner. [plugins.md](../plugins.md) § Node-side extension points has a
point's value carrying a description the host draws, and § Context menus has `item.row` beside
`task.row`, with [contribution-kinds.md](../contribution-kinds.md) naming both locations on one row.
[panes.md](../panes.md) has the `workflows` pane, `list-detail` and gated by `when`;
[notifications.md](../notifications.md) has the `workflow-run` target, the gate as an attention row
and the `run-failed` notice; [managed-agents.md](../managed-agents.md) § Sessions has the config
options a workflow turn carries and the chip a workflow session draws.
[terminal.md](../terminal.md) and [database.md](../database.md) each have their two step kinds and
[http-client.md](../http-client.md) has its one, each beside the safety check that admitted it.
[api-reference.md](../api-reference.md) has the routes, [data-layer.md](../data-layer.md) has
`workflow_defs`, [security.md](../security.md) § Process, path, and configuration controls has the
owner-typed row and the save that re-enters the snapshot, and
[state-ownership.md](../state-ownership.md) § Device has `plugin:workflows:layout:<defId>`.
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) and
[first-party-plugins.md](../first-party-plugins.md) have the three palette rows and the plugin's
grown row, [integrations.md](../integrations.md) has **Start workflow…** as a registry contribution
rather than three menus, and [ui-design.md](../ui-design/closed-kit.md) § The closed kit and
[tui.md](../tui/plugin-losses.md) § What a plugin loses here have the kit's `Graph` node and its two projections.
[workflows.md](../testing/workflows.md) holds what the programme owes: nine manual checks, items 48 to 56, six
for the editor and the run pane, two for the start-from-an-item flow and one for the graph view. None
of them has been run.

`changes/` was six phases that turned the Changes pane's list column into a working git panel: checkbox
staging over three groups, a list-or-tree view, a multi-line commit editor with amend and sign-off, a
branch bar with fetch, pull and push, a model-written commit message, and a point another plugin fills
once a branch is pushed. Shipped and deleted 2026-09-08.
[diff-rendering.md](../diff-rendering/changes-pane.md) owns the panel: § One status read has the one `LocalStatus`
read behind every region and why the two signatures are separate, § Data flow has the navigator, the
checkbox, the three groups, the footer's order, the primary button's verb and the three refresh signals,
and § What the Changes panel refuses has the ten decisions — a branch picker, hunk staging, other
remotes, chords on the remote verbs, a split button, a separate pane, a rail surface, git write tools
for agents, a commit history, and a warning on archive about unpushed commits.
[panes.md](../panes/models.md) § Pane models has the commit draft outliving its region, and
[state-ownership.md](../state-ownership.md) § Scope rules has where the draft, the view preference and
the model pick live. [plugins.md](../plugins.md) § Hooks has `amend` and `force` on the two payloads,
and § Cooperative extension points has `git:push-actions` with its props beside the other
first-party remote points. [security.md](../security.md) § Process, path, and configuration controls has
the lease and the abort verb; [integrations.md](../integrations.md) § Model providers has the commit
message beside the database plugin's SQL as the two `generateText` consumers;
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts/shortcuts.md) § Plugin shortcuts has the two
commit chords and the palette rows; [first-party-plugins.md](../first-party-plugins.md) and
[api-reference.md](../api-reference.md) have the plugin's row and its route surface; and
[changes-and-large-surfaces.md](../testing/changes-and-large-surfaces.md) has smoke items 43 to 47.

`command-palette/` was seven phases that gave acorn one command graph and one host-neutral palette
session. Shipped and deleted 2026-09-03.
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) owns the whole of it: the
five command kinds and the graph's validation rules, the frame stack and what Enter and Escape do,
the search and input and setting semantics with their generation check, scope and the one opt-in
fan-out, the outcome contract, the shared setting accessor, core's own catalogue, and the nine
refusals — a plugin-rendered frame, a second registry, an executable search response, result action
panels, fleet by default, a model called as you type, reflected Settings pages, free-form secrets,
and cross-owner parenting. [plugins.md](../plugins.md) § Command kinds is the manifest half, with the
bounds the host enforces on a loaded search, input and setting;
[plugin-authoring.md](../plugin-authoring.md) and `packages/plugin-types/README.md` are the
third-party halves of the same. Each plugin's own document has its share under "From the command
palette": [database.md](../database.md), [http-client.md](../http-client.md),
[integrations.md](../integrations.md) for Linear and Rollbar, [terminal.md](../terminal.md),
[workflows.md](../workflows.md), [editor.md](../editor.md),
[github-integration.md](../github-integration.md), [managed-agents.md](../managed-agents.md),
[docker.md](../docker.md) and [notes-and-memory.md](../notes-and-memory.md).
[api-reference.md](../api-reference.md) § Command palette routes has the six plugin routes, and
[testing.md](../testing.md) has the fixture suites and the twelve manual checks the programme owes.

Five invariants outlived the folder, and each is a test rather than a paragraph. There is one
`createCommandSession`, and both hosts build theirs from it. Neither host's palette files compose,
fetch, rank or invoke. No manifest frame target and no slot id is the palette. No search response
carries a field that could name an action, a route, a URL or a verb. And there is no palette-row
registry beside the command one — `ctx.paletteRows` and its two published types came off the plugin
API on the same day, which is what moved `PLUGIN_API_MAJOR` to `10`. All five are in
`tools/arch/boundaries.test.ts`.

`performance/` was deleted on 2026-09-03 when its eleventh phase closed it. Its behaviour moved into
the owning docs, and its decisions, refusals and numbers became a dated record. That record,
`docs/performance.md` and `docs/performance/`, was deleted on 2026-09-26 with the second plan,
`legacy/performance/`, which covered desktop startup, task switching, streaming work and memory. What
that plan built is in the owning docs, and each change's before-and-after numbers are in its commit
message. All three are in git history.

The third `performance/` folder was deleted on 2026-10-09. Its phases 01 to 06 shipped that day:
startup and feature measurements with Sentry export, the installed Claude Code, production
minification, startup messages, and loading renderer and server code on first use. The owning docs
describe the result, and each phase's dated evidence is under `docs/testing/` with a 2026-10-09 date.
Phase 07, combined acceptance with packaged-host checks and live Sentry evidence, didn't ship. Its
plan is in git history.

`legacy/` was the architecture review and version-1 reset: thirteen tickets that gave each contract
one owner and one representation, removed compatibility adoption, and reset every database to one
initial migration. Tickets 01 to 12 shipped and ticket 13 recorded acceptance on 2026-09-23; the
folder was deleted on 2026-09-26. The owning docs hold the contracts. What ticket 13 could not prove
on a real host is recorded where it applies: the terminal client has no Terminal drawer receiver
([tui.md](../tui/plugin-losses.md) § What a plugin loses here), agent automation stages the built renderer because
Vite's development proxy drops a cold module ([local-development.md](../local-development.md)), and
the real-window checks the driver cannot reach (a Memory proposal approval, plugin trust, workflow
promotion, native menus, dialogs and keychain prompts) stay manual.

`unarchive.md` recorded the archive page: search, a read-only preview, and restore. Shipped
2026-09-24 and deleted 2026-09-26. [workspaces-and-tasks.md](../workspaces-and-tasks.md) § Restoring
a task owns the behaviour, [plugins.md](../plugins.md) § Search providers owns `ctx.search`, and
[changes-and-large-surfaces.md](../testing/changes-and-large-surfaces.md) item 79 is the manual smoke it owed. Left out on purpose: more search
providers than core tasks and the agents plugin, a loaded-tier search route (loaded task panes can
still opt into the preview with `readsArchived: true` on their `frames` entry), search across active
tasks, external-content FTS (it needs stable rowids and `agent_events` has a text key), opening an
individually archived session in the preview, and bringing back containers, terminal sessions or
scrollback.

`data-capability.md` was the landing page for the host-owned `ctx.core.data` facet, shipped
2026-09-16 and deleted 2026-09-26. [database.md](../database.md), [data-layer.md](../data-layer.md)
and [the-manifest.md](../plugin-authoring/the-manifest.md) § Permissions own it.

`notifications/` was six phases that stopped acorn notifying on every agent step. Shipped and deleted
2026-09-02. [notifications.md](../notifications.md) owns all of it: the five states and the two
adapters, the three edges, the one-second hold and the seen rule, acknowledge on view, the four
channels and the `notify` seam group, the settings schema, the two chimes, and the terminal's OSC
recipe. Its eight invariants are properties in
`packages/client-core/src/features/notifications/invariants.test.ts`. Where a phase's behaviour
belongs to somebody else's contract, that owner took it: [shell.md](../shell/bridge-and-broker.md) § The renderer
bridge has the desktop's two Tauri commands and the focus approximation that stands in for a click
callback, [tui.md](../tui/chrome.md) § What is drawn bespoke has the topbar count, the inbox overlay and the
DEC 1004 focus rule, [plugin-map.md](../plugin-map.md) § Notifications still answers which call a
plugin makes, and [contribution-kinds.md](../contribution-kinds.md) has what an attention
row's severity decides.

`terminal-rewrite/` took the terminal client off OpenTUI and gave it a painter of its own, in five
phases on 2026-09-03 and 2026-09-04. Shipped and deleted 2026-09-04. It had a sixth, a list of
conventions the reference terminal apps have and we lack; it was independent of the rest, it was
never started, and it is in git with the others. [tui.md](../tui.md) owns all of it. § How a frame is
drawn is a new section and the architecture file's four layers landed in it: the plain node tree
Solid mutates, the Yoga pass through the WebAssembly build, the cell buffer with its diff and its
synchronized flush, the byte parser, and the invariant that holds at each boundary. § The runtime
floor is two sentences, because the floor is the repo's — the phases took out the Node 26.4
requirement and the `--experimental-ffi` flag and gave `apps/tui` the `engines` every other package
here has. § The host switch lost the `@opentui/solid` alias and gained the three throwing stubs that
now stand in front of the packages the last phase dropped. § Rendering carries the layout read-back's
clamp where the render guard's paragraph was, plus one sentence each for the two crashes the rewrite
ended, so a reviewer meeting `<Stack>{count()}</Stack>` knows it used to be one. § Rectangles and
§ The Rectangle contract name `@xterm/headless` and the key encoder in front of it. § The adapter
says the `KeymapHost` is ours, all thirteen members of it, and § Focus regions says the store owns
focus with nothing left to disagree with — which is what took the second reveal out of § Scrolling
viewports. § Tests has the harness, which is the real renderer with stdout as a buffer.

Three other docs took a share. [testing.md](../testing.md) § Test layers lost the FFI skip, because
nothing in that suite skips any more. [bundle.md](./bundle.md) § Shipping `acorn` lost the second
native module and the flag in `bin/acorn`, and its open question about which packages the tarball has
to carry is answered. And `apps/tui/scripts/check-startup-graph.mjs` holds the eager closure's honest
number — the painter is about 98 KB inside the bundle where a 6 MB library sat outside it, so the
ceiling went up rather than down.
Two refusals are worth not re-arguing: a Rust or Go painter behind a wire, rejected because
client-core is TypeScript whatever paints the cells, and a constraint layout instead of flex, parked
rather than rejected. Both are in the folder's `refused.md`.

`terminal-updates/` was seven phases that finished the terminal's keyboard, shipped and deleted
2026-09-02. [tui.md](../tui/keys.md) § Keys and focus owns all of it. Phase 0 wired every asking node so it
focuses, shows focus and acts, which is § The adapter and the pressable contract under it. Phase 1
rewrote the region store into five levels with one settle pass and a shell-installed topology, and
phase 4 moved the shell's own arrangement into `chrome/topology.ts`; both are § Focus regions and
§ Navigation. Phase 2 gave the arrows the stops of a panel and Escape the climb to its parent, and
phase 3 made a `Tabs` strip with `TabPanel`s a parent stop without a prop, paired by `idPrefix`; both
are § Focus regions. Phase 5 took the `ExtendedPane` seam, `rows` as a collection and the diff
annotation marks into cells, and § What a plugin loses here is the table it produced. Phase 6 turned
the eight invariants into properties over the pane roster and gave the footer a word per kind of
focused thing: § The invariants and § The footer, with the suites in
[testing.md](../testing.md) § Test layers. The focus model that every phase pointed at is § The five
key groups and § The invariants; the two invariants that changed on contact with the build say so
there.

`terminal-keyboard/` was seven phases that re-founded the terminal client's focus and keys after the
model under them had been rewritten ten times in three days, each time correctly, for a bug somebody
saw. Shipped 2026-09-02. [tui.md](../tui/keys.md) § Keys and focus owns all of
it, and the review's finding was that five reports came from four structural faults and one scrolling
fault, so
each of its five rules went to the subsection that owns the mechanism. Rule 1, the renderer is the
only truth about focus, is § Focus regions: one listener on the renderer's focus event writes the
store, one function moves focus and reports what the renderer did, and the mouse arrives through the
same door as a key. Rule 2, a trap is a scope rather than a swallow, is § Traps, with the leak it
removed named there: a swallow has to list the keys it eats, and the list it read was not the list
`install.ts` binds, so Tab walked out of every dialog. Rule 3, one landing rule in place of a
seven-step pass over four global flags, is § Focus regions again: one question about the renderable
that has the keys, then four steps, and the one deferred decision the invariants hold the folder to.
Rule 4, named tiers and honest claims, is § The five key groups and the tier table in
`apps/tui/src/keys/tiers.ts`, which is the only file under `apps/tui/src` that spells a priority; it
is also where the reversal lives that made a tab-strip edge bubble instead of walling, so Left means
one thing everywhere. Rule 5, anything that can exceed its box is a viewport, is § Scrolling
viewports, with the page-key clamp in the shared
`packages/client-core/src/kit/keys/collectionIntents.ts` so the desktop keeps the same rule. The
rectangle that closed the programme is § The Rectangle contract: being entered is derived from the
box rather than remembered in a flag. The three invariants the programme added are rows 9 to 11 of
§ The invariants, and the trace flag a developer turns on first is § Seeing what the keys did. What
it refused is recorded where the refusal binds: no column wrap and an arrow edge as a wall in
§ Focus regions, no second keymap in § What must never happen, and the four manual checks it still
owed are items 27 to 30 of [terminal-and-palette.md](../testing/terminal-and-palette.md).

`structure/` was eight phases that made the folder names say what the architecture doc says: `main/`
retired everywhere, client-core regrouped into `kit/`, `host/`, `infra/`, and `features/`, one shape
for every plugin, and a front door for the docs. Shipped and deleted 2026-08-30. Its rules live in
[conventions.md](../conventions.md), the plugin shape in [plugins.md](../plugins.md) § Package shape,
the package boundaries in [architecture-overview.md](../architecture-overview.md) § Package
boundaries, the index in [README.md](../README.md), and the CI that runs the arch suite in
[testing.md](../testing.md).

`terminal/` was nine phases that built a second host for the whole workspace: `acorn`, client-core
booted under Node, drawing the same panes in cells. Phases 0 to 6 shipped on 2026-08-31 and the folder
was deleted the same day. [tui.md](../tui.md) owns the client — the process model, the config
directory, the host switch, the chrome, the keys, the sandbox and the doors it left open — and the
behaviour that belongs to a shared contract went to that contract's owner instead:
[ui-design.md](../ui-design/closed-kit.md) §§ The closed kit, What a terminal renderer needs from this and Every
node at 80 by 24 for the kit and the role tokens, [panes.md](../panes/layout.md) § Layout model for the
projections, [command-palette-and-shortcuts.md](../command-palette-and-shortcuts/focus-and-typing.md) § Focus and
typing for the intents and the layers, [security.md](../security.md) §§ Trust boundaries, Transport
and auth, Third-party plugin bundles and The containment ladder for the worker-thread sandbox,
[plugins.md](../plugins.md) § The tree contract for the shared batch rules,
[first-party plugins in the terminal](../first-party-plugins/terminal.md) for the
plugin-by-plugin table, [terminal.md](../terminal.md) § Client and [editor.md](../editor.md) for
`attachPty` and the `$EDITOR` handoff, [node-distribution.md](../node-distribution.md) § Reaching a
node with `acorn`, and [testing.md](../testing.md) § Test layers for the six suites. Phase 7's tarball
half shipped with the headless CLI on 2026-09-27: `scripts/pack-node.mjs` stages the shared launcher
and both client bundles. Embedding that launcher in the desktop app and the platform release pipeline
remain in [bundle.md](./bundle.md) § Shipping `acorn`.

`before-terminal-ui/` was eight phases that emptied the plugin client tier of the raw DOM a second
host cannot draw, shipped and deleted 2026-08-31. The kit grew four nodes and
[ui-design.md](../ui-design/closed-kit.md) §§ The closed kit and Every node at 80 by 24 owns them; the file
dialogs are two verbs on the platform seam in [frontend.md](../frontend.md), which also owns the
`{ seam: … }` host requirement that replaced the preview pane's desktop gate; the editor is
CodeMirror with an `$EDITOR`-in-a-PTY mode and [editor.md](../editor.md) owns both, with
[first-party-plugins.md](../first-party-plugins.md) carrying the row. The survey that started it
lives on in the corrected plugin table in [first-party-plugins.md](../first-party-plugins.md) § What
each of these loses in a terminal and in the baseline comment on the client-tier purity rule in
`tools/arch/boundaries.test.ts`, which is the programme's last deliverable and the reason none of it
can leak back.

`structure-followup/` was the three places the whiteboard drawing still lied once `structure/` had
moved the folders, in three phases and a sweep, shipped and deleted 2026-08-31. The custody package is
named for what it holds rather than for the desktop that spawns it, and
[architecture-overview.md](../architecture-overview.md) § Package boundaries owns the paragraph, with
[shell.md](../shell.md) owning the desktop process that kept the word "helper". Core no longer names a
plugin: a task's origin is a source id its plugin declared
([architecture-overview.md](../architecture-overview.md) § Product model,
[workspaces-and-tasks.md](../workspaces-and-tasks.md)), a section is shaped by the package that owns
its rows ([agent-tools.md](../agent-tools.md) § Context sections), a harness declares the MCP command
lines its CLI wants ([mcp.md](../mcp.md) § Configuration), and `core never names a plugin` in
`tools/arch/boundaries.test.ts` holds the rest as an allowlist with a reason per file. And the plugin
context type says which tier each member belongs to, so reaching across the line is a `tsc` error
instead of a runtime "not a function" ([plugins.md](../plugins.md) §§ The two contexts, one per tier
and One vocabulary across the registries). The four facts it named to keep a cloud control plane
possible sit with their owners: the dial in [plugins.md](../plugins.md) § Node providers, the two node
ids in `packages/protocol/src/device/nodeProviders.ts`, `ACORN_BUNDLED_PLUGINS_DIR` as a developer path in
[node-distribution.md](../node-distribution.md) § Plugins, and the opaque `options` bag beside its
schema.

`layout/` was the largest of them: eleven phases that made every pane a host-owned layout filled with
a tree of closed-kit components, shipped and deleted 2026-08-30. Its behaviour lives in
[ui-design.md](../ui-design/closed-kit.md) § The closed kit and § Every node at 80 by 24,
[panes.md](../panes/layout.md) § Layout model, [plugins.md](../plugins.md) §§ The tree contract and
Cooperative extension points and Hooks,
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts/focus-and-typing.md) § Focus and typing,
[shell.md](../shell/origins.md) § The plugin worker, and [security.md](../security.md) § Rung 0.


`telemetry/` shipped all six phases and was reviewed and deleted on 2026-09-11.
[telemetry.md](../telemetry.md) owns the collector, runtime seams, consent, exporter, deliberate
limits and verification gap for a live Sentry project. [plugin-authoring.md](../plugin-authoring.md)
owns the author API and [integrations.md](../integrations.md) the DSN connection. Runtime-specific
details live in [frontend.md](../frontend.md), [tui.md](../tui.md) and [shell.md](../shell.md).
