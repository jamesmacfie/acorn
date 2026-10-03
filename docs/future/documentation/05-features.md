> **Completed 2026-10-04** by the "Phase 5 Product features" task.
>
> **What landed:** All 16 docs were checked against the code, restyled, and cut to 200 lines or fewer.
> Every doc except `docker.md` is now a landing page over topic pages in a folder of the same name,
> with old-heading `<a id>` anchors on each landing page: 75 topic pages in all, every one listed in
> a new "Feature topic pages" section of `docs/README.md`. About 500 source citations in 334 files
> now name the topic pages, and the citation allowlist shrank from 177 to 78 lines, with no
> entries left for this phase's docs.
>
> **Deviations:** (1) More pages than the plan named. `managed-agents/` has 19 topic pages, not six,
> because each of the plan's six would have run past 200 lines: `subagents`, `custom-agents`,
> `providers`, `app-access`, `session-events`, `history-retention`, `palette`, and `attachments` split
> off. `client-surfaces.md` split by surface into `client-surfaces`, `transcript`, `composer`,
> `transcript-store`, and `transcript-search`. `workflows/` has 15 pages, `integrations/` eight (the
> plan asked for model providers, Linear, Rollbar, and Sentry, and settings, contributions, project
> sources, and provider boundaries split off too). (2) `dashboards.md` was 108 lines but owned 56 broken
> citations: a September rewrite deleted the sections source comments cite. I wrote those sections
> again from the current code in `docs/dashboards/` (`panels`, `views`, `mapping-and-editor`,
> `placements`, `sampling`), with heading text matching the citations. "Trends: the stat that earns a
> sparkline" became "Trends", because source cites `§ Trends`. (3) `data-sources.md` stays its own doc:
> it owns the typed source contract, and `integrations.md` owns connections, so they don't duplicate.
> (4) "Gaps" moved to `docs/future/workflows-gaps.md`, added to the future README. "What workflows
> refuses" is `workflows/refusals.md`, cut from 50 entries to the ones that stop a decision being
> reopened. (5) Code won over the docs: the persisted dashboards envelope is version 1, not 2; the `dev`
> base target comes from the project row, not `workspaces.devScript` (the `runConfig.ts` comment is
> fixed too); archive has no review-input capture step; ten built-in workflow kinds describe
> themselves, not nine; the browser tools are `navigate`, `snapshot`, `click`, `fill`, `screenshot`,
> and `console`, not "act"; branch name rules are `slugifyBranch` and `dedupeBranch`;
> `ToolImageResult` is in `transport/api/taskSupport.ts`; stat and panel UI labels are "Recording once an
> hour from today.", **Move or resize**, and **Remove from this dashboard**. (6) Stale `§2`, `§3`, and
> `§4` citations to `workflows.md` and `agent-tools.md` now cite project configuration, run targets,
> worktree copy, and the task context route. (7) Outside this phase I edited links only, plus one
> paragraph of `data-layer/plugin-databases.md`, whose generation caps moved to `database/pane.md` as
> phase 3 asked. (8) `docs/README.md` is 326 lines, because it lists every topic page.
>
> **For later phases:** `slug()` drops underscores, so a heading `## issue_detail` has the ID
> `issuedetail`, and an `<a id="issue_detail">` anchor matches nothing. The heading must be a prefix of
> the cited text on a word boundary, so `§ Trends` can't match "Trends: the stat…", and `§ Sessions`
> can't match "Session model". An H1 counts as a heading, which is the cheap way to make a page title
> catch `§ <page title> …` citations. The throwaway rewrite script I used (not committed) rewrote
> `docs/<landing>.md § Heading` to the topic page owning the longest matching heading, but skipped
> citations whose `§` wraps to the next line, so check those by hand with
> `git grep -n "docs/<landing>.md$"`. Phase 6 owns the 78 remaining allowlist lines, all for
> `plugins.md`, `plugin-authoring.md`, `docs/plugins/forward-compatibility.md`, `first-party-plugins.md`,
> and `contribution-kinds.md`, and every doc the length report still lists. Several topic pages here
> link into `plugins/*.md` anchors (`#remote-trees`, `#asking-the-owner`, `#context-menus`,
> `#task-checks`, `#search-providers`, `#hooks`, `#the-tree-contract`), so keep those headings or leave
> anchors when you split. Claims that need a running app weren't checked live: UI labels were checked
> against source strings only, and I didn't run `pnpm dev:agent`. Package test suites weren't run,
> because the source changes are comments and test titles only.

# Phase 5: Product features

Date: October 3, 2026. Status: proposed, not started. Part of the
[documentation overhaul](./README.md). Do [phase 1](./01-guardrails.md) first.

These pages describe what a user does in acorn: tasks, agents, terminals, integrations, workflows,
and the feature panes.

## Docs in this phase

| Doc | Lines | Source citations |
| --- | --- | --- |
| [workspaces-and-tasks.md](../../workspaces-and-tasks.md) | 441 | 78 |
| [managed-agents.md](../../managed-agents.md) | 1,416 | 93 |
| [managed-agents/client-surfaces.md](../../managed-agents/client-surfaces.md) | 666 | 5 |
| [terminal.md](../../terminal.md) | 514 | 23 |
| [agent-tools.md](../../agent-tools.md) | 492 | 58 |
| [dashboards.md](../../dashboards.md) | 108 | 91 |
| [integrations.md](../../integrations.md) | 611 | 82 |
| [data-sources.md](../../data-sources.md) | 245 | 0 |
| [github-integration.md](../../github-integration.md) | 468 | 27 |
| [workflows.md](../../workflows.md) | 881 | 105 |
| [workflows/execution.md](../../workflows/execution.md) | 332 | 3 |
| [workflows/authoring.md](../../workflows/authoring.md) | 375 | 0 |
| [notes-and-memory.md](../../notes-and-memory.md) | 214 | 23 |
| [http-client.md](../../http-client.md) | 229 | 28 |
| [docker.md](../../docker.md) | 155 | 5 |
| [database.md](../../database.md) | 249 | 12 |

## Known problems

### managed-agents.md

At 1,416 lines, this is the longest reference page. "Harnesses" runs 281 lines, "Operations and
failure" runs 235, and "Session model" runs 151. A split into `docs/managed-agents/`:

| New page | Takes |
| --- | --- |
| `sessions.md` | HTTP control authority, standing memory, and the session model |
| `harnesses.md` | Harnesses and provider-native subagents |
| `delegation.md` | Managed delegation and custom agents |
| `activity.md` | Web activity, file changes, context, files, and attachments |
| `defaults.md` | New-session defaults and palette commands |
| `operations.md` | Operations and failure |

The "Source map" section at the end goes stale fastest. Replace it with source paths inside each
topic page. `managed-agents/client-surfaces.md` came out of an earlier split as one 666-line
section. Split it again by surface.

Thirty-three source comments cite a deleted `docs/terminal-and-agents.md`. Phase 1 points
them at this page or at `terminal.md`.

### workflows.md

"What workflows refuses" runs 202 lines, longer than most whole pages. Cut it to the refusals that
stop a reader from reopening a decision. "Gaps" is proposal material. Move it to `docs/future/`.
"Routes and UI" runs 140 lines and belongs in its own page beside `execution.md` and `authoring.md`.

### integrations.md

"Model providers" runs 139 lines. Give it a page in `docs/integrations/`, with one page
each for Linear, Rollbar, and Sentry. Check every provider and capability against the plugin
manifests in `plugins/`.

### workspaces-and-tasks.md

"Worktrees and setup" runs 165 lines. Split it out. Check the task script states against
`packages/protocol` before rewriting them.

### agent-tools.md

Check every tool name against the tool registrations in source. Tools get renamed and removed more
often than prose gets updated.

### data-sources.md

No source comment cites this page. Check whether it still owns the contract, or whether
[integrations.md](../../integrations.md) does. Merge it if the content duplicates.

## Done means

- Each doc in the table follows the [house style](./style.md) and is 200 lines or shorter.
- Every tool, route, and palette command named exists in source.
- No feature doc holds proposals or gap lists. Those live in `docs/future/`.

## Verify before you start

- Read the latest entries in `docs/release-notes.md`. Features shipped since a page was written
  are the likeliest omissions.
- Check `plugins/*/package.json` manifests for the contribution names these pages use.
