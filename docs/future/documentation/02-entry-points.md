> **Completed 2026-10-03** by the "Phase 2 Entry points" task.
>
> **What landed:** All eight entry-point docs were checked against the code, restyled, and cut to 200
> lines or fewer. `testing.md`, `local-development.md`, and `architecture-overview.md` are short landing
> pages, with old-heading `<a id>` anchors, over new topic pages in `docs/testing/`,
> `docs/local-development/`, and `docs/architecture/`. About 90 source comments now cite the new pages,
> eight allowlist lines are gone (420 to 412), and `docs/README.md` lists every new page.
>
> **Deviations:** (1) More pages than the plan named. `docs/testing/architecture-rules.md` takes the
> source-shape rules, kit invariants, doc checks, and non-vacuity, because `layers.md` couldn't hold
> them in 200 lines. `docs/architecture/node-api.md`, `fleet.md`, and `control-plane.md` take the Node
> API, the client and fleet rules, and the three parties, because the overview was still 253 lines with
> only `packages.md`. (2) The smoke checklist's items 10 to 99 and 145 to 148 were stale copies of
> checks that already live in the `docs/testing/` area files, so I deleted the copies instead of moving
> them. The release pass is `docs/testing/smoke-checklist.md`. Checks 100 to 144 went to
> `docs/testing/settings.md`, 149 to 154 to `docs/testing/computer-use.md`, and both memory sections to
> `docs/testing/memory.md`, because the memory programme record was deleted. (3) I edited
> `docs/testing/manual-checks.md` beyond a link fix, to add rows for those three pages. (4) I pruned the
> `docs/README.md` subfolder list to `future/` and `schemas/`, because the future README already
> indexes every programme. (5) I repointed links in other phases' docs (`diff-rendering`, `frontend`,
> `managed-agents`, `shell`, `telemetry`, `tui`, `node-enrollment`) and three broken links in
> `docs/future/cloud/`. (6) No release tag exists, so `release-notes.md` states version 1.0.0 with no
> tag. It also dropped "import is planned", because memory import shipped on October 2, 2026.
>
> **For later phases:** Moved sections keep anchors on the landing pages, so `§` citations to old
> headings still pass, but cite the new file in new comments. Vitest hides the citation report when
> either `CLAUDECODE` or `AI_AGENT` is set. Run `env -u CLAUDECODE -u AI_AGENT npx vitest run
> docCitations` in `tools/arch`. Phase 1's command unset only the first and prints nothing. The length
> report counts subfolder pages, so a new topic page must also stay under 200 lines. It skips
> `docs/testing/`. `docPaths.test.ts` treats a retired directory name as gone only when the same line
> says "deleted". Known gap kept in `smoke-checklist.md`: the light-theme `--is-dark` bug is still in
> `tokens-theme.css`. Claims needing a running app were not rechecked: the manual check steps and the
> agent-driver session behavior. `pnpm lint`, the arch suite, `pnpm db:check`, and the focused-test and
> CLI help commands ran, but I didn't run `pnpm dev` or `pnpm dev:agent`.

# Phase 2: Entry points

Date: October 3, 2026. Status: proposed, not started. Part of the
[documentation overhaul](./README.md). Do [phase 1](./01-guardrails.md) first.

These are the pages a developer or an agent reads first. Fix them before the reference pages,
because every later phase links back here.

## Docs in this phase

| Doc | Lines | Source citations |
| --- | --- | --- |
| `README.md` (repository root) | 114 | Not counted |
| [docs/README.md](../../README.md) | 187 | 5 |
| [architecture-overview.md](../../architecture-overview.md) | 578 | 81 |
| [features.md](../../features.md) | 146 | 1 |
| [conventions.md](../../conventions.md) | 152 | 8 |
| [local-development.md](../../local-development.md) | 458 | 19 |
| [testing.md](../../testing.md) | 1,508 | 36 |
| [release-notes.md](../../release-notes.md) | 81 | 0 |

The files in `docs/testing/` belong here for links only. Their dated results are evidence.

## Known problems

### testing.md

At 1,508 lines, this is the longest doc. "The smoke checklist" alone runs from line 579 to line
1412. "Memory phase 3 acceptance" records one programme's acceptance, not how to test. A split:

| New page | Takes |
| --- | --- |
| `docs/testing/commands.md` (new) | Commands, focused agent runs, and coverage measurement |
| `docs/testing/layers.md` (new) | Test layers, composition-root tests, the testkit, and non-vacuity |
| `docs/testing/desktop.md` (new) | The desktop boot test, the browser smoke test, and the large-surface fixture |
| `docs/testing/ci.md` (new) | Continuous integration and reliability, with historical failures labeled by date |
| `docs/testing/smoke-checklist.md` (new) | The smoke checklist, split again by area if it stays past 200 lines |

Move the memory acceptance section into the testing check-list it belongs to, or into the owning
programme record. `AGENTS.md` links to `docs/testing.md#focused-agent-runs`. Keep that anchor on the
landing page.

### architecture-overview.md

"Package boundaries" runs 173 lines and "Node API and client flow" runs 95. Both duplicate parts of
[conventions.md](../../conventions.md) and [api-reference.md](../../api-reference.md). Keep the
overview as a map that links to owners. Move package boundary detail into
`docs/architecture/packages.md` (new) or into conventions. "The three parties, and what a control
plane may hold" describes cloud work that is proposed. Check it against [the cloud
programme](../cloud/README.md) and keep only what ships.

### local-development.md

"Start" runs from line 36 to line 262 and mixes the normal dev loop with the agent drivers. Split
the agent-driven desktop and terminal sections into `docs/local-development/agent-drivers.md` (new),
since `AGENTS.md` sends agents there. Move "Timing a cold start" and "Timing a task switch" into
`docs/local-development/profiling.md` (new).

### docs/README.md

The index has a "Pi implementation handoffs" list that indexes files inside `docs/future/`. The
future README already indexes them. Drop the duplicate list. After phases 2 to 6, the index must
list every new topic page.

### Root README.md

Check the setup steps against `package.json` and `node-runtime.json`. Link to `AGENTS.md` for
agents and to `docs/README.md` for everything else.

### release-notes.md

Release notes are dated by nature, so time words are fine here. Check that the version and contents
match the last release tag.

## Done means

- Each doc in the table follows the [house style](./style.md) and is 200 lines or shorter.
- The new `docs/testing/` and `docs/local-development/` pages are in the index.
- Every command in these pages runs as written on a clean checkout.

## Verify before you start

- Run every command these pages show. Commands rot faster than prose.
- Check the `pnpm` scripts in the root `package.json` and in `apps/desktop/package.json`.
- Check `tools/arch/docPaths.test.ts` for its list of root files. It reads `README.md` and
  `AGENTS.md`.
