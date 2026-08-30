# Phase 7: the rule becomes a test, and the record becomes true

Status: not started. Waits on phases 0 to 6.

## Goal

Kit purity in the client tier is a test with an empty baseline, so the discipline the earlier phases
restored cannot leak again. And the terminal programme's plugin table matches the plugins that
actually exist, so its phase 6 sweep starts from a true list.

## Why this phase, and why now

The arch rule that keeps the four tree directories clean has no sibling for `plugins/*/src/client`,
which is how seven files of raw DOM accumulated behind a convention. This repo's pattern for closing
that kind of gap is a baseline that only shrinks — but by this phase the offender list is empty, so
the rule can land in its endgame shape, an empty baseline that makes any new offence a red test on
the first commit. It goes last on purpose: landing it earlier means maintaining a baseline file that
every other phase edits.

## Scope

In:

- **The arch rule splits in two.** In `tools/arch/boundaries.test.ts`, the tree-directory rule keeps
  the checks that define the tree tier (the components-barrel ban stays tree-only — client
  directories are *supposed* to import `@acorn/plugin-api/ui`). The kit-purity half — the RAW_TAG
  regex over comment-stripped source, the `class=`/`classList=`/`style=`/`innerHTML` check, the
  stylesheet walk — extends to every `plugins/*/src/client` directory, discovered by walking
  `plugins/` rather than hard-coding the list, with `isTestCode` exempting test files (the jsdom
  tier renders regions and may scaffold). Baseline: `const CLIENT_DOM_BASELINE: string[] = []`, with
  the comment recording the seven files that were here on 2026-08-31 and which phase removed each.
  Anti-vacuity: the walker found more than forty files.
- **The terminal programme's plugin table corrected** (`docs/future/terminal/01-why.md`): a row for
  onboarding (crosses: all of it; the wizard layout draws from its terminal projection and the ASCII
  splash is already monochrome), a row for workflows (crosses: the settings page), a line noting
  model-providers and nodes-file have no client half, and the preview/browser row corrected —
  browser has no UI of its own, its tools are node-side. A note that settings pages are
  contributions the terminal's own chrome will host, so their purity matters even though the
  desktop's settings modal does not cross.
- **`docs/first-party-plugins.md`** corrected where it says workflows registers no UI.
- **`docs/future/README.md`**: this programme's status row updated to done, and per house rules the
  folder is deleted with its behaviour rehomed — the survey's facts live in the corrected table and
  the arch test's comments, and the retired-folders section says so.

Out: extending the purity rule to `packages/client-core` features or the app shells. Core chrome
(the settings modal, the rail) is host code and draws DOM legitimately; the rule is about the plugin
tier, where the tree contract's promise lives.

## Design detail

**Two rules, one vocabulary.** After the split, the tree rule and the client rule share the regex,
the comment-stripping, and the stylesheet walk — extract them rather than copying, so the two tiers
cannot drift on what "raw DOM" means. The difference between the tiers is exactly two lines: which
directories, and whether the components barrel is banned or required.

**An empty baseline is the assertion.** No MAX counter, no shrinking list: `expect(offences).toEqual([])`
over every client directory. If a future phase genuinely needs an exception, it adds a baseline
entry with a `// why this survivor is here` comment, the pattern the named-import baseline already
uses — but it starts empty and the burden is on the exception.

**The cross-programme edit is legitimate.** Both this folder and `docs/future/terminal/` are
proposals; correcting the terminal's plugin table is not rewriting a shipped record, it is fixing a
survey that predates four plugins' current shape. The terminal programme's phase 6 verify step
("the plugin table still matches the plugins") passes afterwards, which is the point.

## Code touched

- `tools/arch/boundaries.test.ts`
- `docs/future/terminal/01-why.md`
- `docs/first-party-plugins.md`
- `docs/future/README.md`

## Tests

This phase is a test. Its own checks:

- The new rule passes with the empty baseline on the tree as the earlier phases left it.
- Reverting any one earlier phase's diff makes it fail (spot-check one: reintroduce a `<p>` in the
  context picker, watch the red).
- The tree-directory rule still fails on a barrel import, proving the split lost nothing.

## Docs owed

All of this phase is docs owed; the rows are in [docs-migration.md](./docs-migration.md).

## Doors left open

1. The same purity rule over `plugins/*/src/tree` and `src/client` unified into one walk when the
   tree tier's extra checks are the only difference left.
2. A rule for the onboarding-style `ui/host` imports, if the host-only barrel ever needs its own
   admission story.

## Done when

- `pnpm lint` and the arch suite are green with the empty baseline.
- The terminal programme's plugin table names every plugin under `plugins/` with a UI, and only
  those.
- `docs/future/README.md` reflects the programme's end state, and this folder is deleted in the
  same change.

## Verify before building

- Phases 0 through 6 have shipped: the scan from [01-survey.md](./01-survey.md)'s verify list
  returns zero offenders. If it returns any, this phase waits.
- The tree-directory rule in `boundaries.test.ts` still has the three checks and the hardcoded
  four-directory list described in the survey.
- `docs/future/terminal/01-why.md` still lacks rows for onboarding and workflows.
- `docs/first-party-plugins.md` still carries the stale workflows line.
