# WP-06 — Move github-named CSS out of client-core (F10d)

**Effort:** S–M · **Depends on:** nothing (parallel-safe with WP-03/04/05 — different files).

## Context — finding 10, docs/analysis.md

Four stylesheets in `packages/client-core/src/styles/` are named for plugin concerns:

| File | LOC | Styles |
|---|---|---|
| `pull-detail.css` | 538 | `plugins/github/src/client/PullDetail.tsx` |
| `integrations-panel.css` | 416 | integrations settings panels (possibly genuinely core — see slice 1) |
| `checks-panel.css` | 129 | github checks panel |
| `pull-list.css` | 110 | `plugins/github/src/client/PullList.tsx` |

The plugin-CSS mechanism already exists — components import their stylesheet directly (see
`plugins/agents/src/client/AgentPane.tsx:23` → `import './managed-agents.css'`). So this is a
move-and-reimport, not a mechanism build. Finding 10 also mentions eager GitHub/Linear CSS counting
against a 200 KB budget — check whether these files are pulled in via the aggregate
`packages/client-core/src/styles.css` (imported at `apps/desktop/src/app/client/index.tsx:8`) and
whether moving them makes loading lazier or just relocates it.

Appearance system constraints (repo memory + `docs/ui-design.md`): `data-theme` owns colour,
`data-style` owns shape/type/space/density — disjoint, test-enforced token sets; pick borders by
role. There is a CSS hygiene harness in client-core (locate via
`git ls-files 'packages/client-core/**' | grep -i css` and `grep -rln 'styleSheets\|cssHygiene'
packages/client-core/src`) — moved files must keep passing it or the harness must learn to walk
plugin CSS too.

## Pre-flight

```sh
ls -la packages/client-core/src/styles/ | grep -E 'pull|checks|integrations'
grep -rn 'pull-detail.css\|pull-list.css\|checks-panel.css\|integrations-panel.css' \
  packages apps plugins --include='*.ts*' --include='*.css'
grep -rn 'class="pull-\|class="checks-' plugins/github/src/client | head
grep -rln 'cssHygiene\|readStyleSheets' packages/client-core/src tools
```

Establish: who imports each file, which components use its classes, what the hygiene tests cover.

## End state

- The three github-shaped stylesheets live in `plugins/github/src/client/`, imported by their
  components; deleted from `packages/client-core/src/styles/`.
- `integrations-panel.css`: **decide at slice 1** — if its classes are used by core settings UI
  (`packages/client-core/src/settings/`), it is core and gets *renamed* to a role-named file, not
  moved; if used only by plugin panels, it moves like the others.
- Token usage unchanged — plugin CSS keeps consuming the same custom properties; no token
  definitions move (tokens are core's).

## Non-goals

- No visual changes of any kind — this is a file move.
- No splitting `pull-detail.css` internally (if WP-10a's component split wants that later, it does
  it there).
- No lazy-loading framework — only note in Progress whether the move changed eager CSS weight.

## Slices (one commit each)

1. **Audit + decision.** Map each file's importers and class consumers (pre-flight output),
   decide `integrations-panel.css` (move vs rename), amend this doc with the decision and why.
2. **`checks-panel.css`** — move, reimport from the consuming component, remove from any aggregate
   import, hygiene tests green. Smallest file first to prove the pattern.
3. **`pull-list.css`** — same.
4. **`pull-detail.css`** — same.
5. **`integrations-panel.css`** — execute slice 1's decision.

## Gates

Per slice: `pnpm --filter @acorn/client-core test` (hygiene + adoption suites live here),
`pnpm --filter @acorn/plugin-github test`, `pnpm lint`. Package end: desktop e2e — the smoke spec
renders the PR surfaces; a missing stylesheet shows up as broken layout in screenshots if the spec
captures any, otherwise rely on the user QA note.

## Risks & rollback

- **Unstyled flash / missing styles** if a class is used by a component that doesn't import the
  moved file — the slice-1 consumer map is the guard; verify every class's consumers, not just the
  obvious component.
- **Import-order/cascade changes:** moving a file from the aggregate to a component import changes
  when it loads; if any selector relied on order against another sheet, the audit must catch it
  (grep for identical selectors across sheets).
- Pure file moves — each slice reverts cleanly.

## Doc updates

`docs/ui-design.md` (where plugin styles live) — with slice 2 (first move). User QA note: open a
PR detail, the checks panel, the pull list, and the integrations settings panel across two themes
and two style packs; everything should look identical to before.

## Done criteria

- [x] No GitHub-owned feature CSS remains under `packages/client-core/src/styles/`.
- [x] The `integrations-panel.css` decision is recorded and executed as `integrations.css`.
- [ ] Hygiene/adoption suites are green; desktop e2e and live visual QA remain blocked/deferred as recorded in the final migration audit.

## Progress

- [x] Slice 1 — audit + integrations decision
- [x] Slice 2 — checks-panel.css
- [x] Slice 3 — pull-list.css
- [x] Slice 4 — pull-detail.css
- [x] Slice 5 — integrations-panel.css

Completion note (2026-08-08): `checks-panel.css`, `pull-list.css`, and `pull-detail.css` now live
with the GitHub plugin and are imported by their owning components. `integrations-panel.css` was
shared by core integration settings and GitHub pull-detail rows, so it was retained in core under
the role-named `integrations.css`. The existing style walker already scans plugin sources; token
values and selector behavior were not changed. Hygiene and package tests are covered by the final
validation pass; visual QA remains part of the migration audit.
