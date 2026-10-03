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
