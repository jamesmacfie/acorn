# Docs migration

Every document under `docs/` that changes because of this folder, which phase changes it, and how.
Phase "docs" is the change that created this folder on 2026-08-30. It deleted `docs/future/terminal.md`,
repointed its inbound links, and the paragraphs elsewhere that restated its design collapsed
to pointers. Phase 8 is the reverse move, when the folder is deleted and behaviour goes to owning docs.

## Done in phase "docs" (2026-08-30)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/future/terminal.md` | whole file | Deleted. `01-why.md`, `02-survey.md`, `06-isolation.md`, and the README's decisions table hold its content. |
| `docs/future/README.md` | The programmes | Row added for `terminal/`. |
| `docs/future/README.md` | The single files | `terminal.md` row removed. |
| `docs/future/README.md` | How these relate | The terminal sentence points at the folder. |
| `docs/future/bundle.md` | title paragraph, Native dependencies, The build pipeline, Docker, The snags, Whether to bundle a Node runtime, One artifact two hosts, Ordering, Not in scope | Two deployables; two native modules; the runtime moves up; the barrel rule's mirror; pointers to `08-deployables.md`. |
| `docs/ui-design.md` | What the kit and layouts must never do | Link repointed to the folder. |
| `docs/ui-design.md` | What a terminal renderer needs from this | Framing sentence names the folder as the host that reads these; the seven bullets stay (they are shipped, tested constraints); the last bullet's link points at `01-why.md`. |
| `docs/extensibility.md` | Related | Two bullets repointed. |
| `docs/editor.md` | header, three body mentions, Related | Links repointed to `01-why.md`; prose that argues from the terminal is unchanged. |
| `docs/future/remote.md` | header | The terminal is named as the third surface with a link to the folder. |
| `docs/future/client-plugins/README.md` | What this folder is not | `terminal.md` → `terminal/`. |
| `docs/future/client-plugins/07-hosts.md` | The terminal | Collapsed to a pointer at `06-isolation.md`, which now owns custody, provenance, and the trust prompt for the terminal. |
| `docs/future/client-plugins/06-user-config.md` | Why it waits | "toy host" → `phase-3-process-and-auth.md` (the config directory exists after it). |
| `docs/future/client-plugins/phase-4-device-config.md` | status line, Why this phase | Same. |
| `docs/future/client-plugins/phase-0-device-held-bundles.md` | Scope, Docs owed | `terminal.md` → `terminal/06-isolation.md`. |
| `docs/future/client-plugins/docs-migration.md` | the table | The `terminal.md` row names `terminal/06-isolation.md`. |

Untouched on purpose, because they describe shipped behaviour and the terminal only reads it:
`docs/plugins.md § The tree contract` (the "cell buffer" and "eleven names" sentences),
`docs/plugin-authoring.md` (raw key handlers dropped), `docs/command-palette-and-shortcuts.md` (the
adapter sentence), `docs/future/compiled-tier.md`, and the `monaco.md` argument paragraphs.

## Owed by phases 0 to 7

| Doc | Section | Phase | What it says afterwards |
| --- | --- | --- | --- |
| `docs/ui-design.md` | The closed kit | 0 | `HOST` is supplied per host package; `dom` and `tui` exist. |
| `docs/ui-design.md` | owning sections | 0 | Any kit dishonesty phase 0 found, fixed for both hosts. |
| `docs/ui-design.md` | Every node at 80 by 24 | 1 | Each `reduced` node's loss in its row. |
| `docs/ui-design.md` | What a terminal renderer needs from this | 1 | "tested for presence even though nothing reads it" → "read by the TUI host". |
| `docs/testing.md` | Test layers | 1, 3, 6 | The `tui` vitest project; the TUI boot test; pane snapshots. |
| `docs/panes.md` | Layout model | 2 | Projections are drawn; any that changed on contact. |
| `docs/command-palette-and-shortcuts.md` | Focus and typing | 2, 4 | The terminal adapter is used; the double-Escape rule; the region cycle and the footer. |
| `docs/terminal.md` | the PTY | 2, 6 | The PTY on the TUI; the editor handoff; docker exec. |
| `docs/node-distribution.md` | reaching a node | 3, 7 | `acorn` beside the desktop; `bin/acorn` in the tarball layout. |
| `docs/security.md` | Transport and auth | 3 | The terminal sets the bearer on the upgrade itself. |
| `docs/security.md` | Trust boundaries, Transport and auth, Third-party plugin bundles, The containment ladder, summary table | 5 | The terminal column, per `06-isolation.md`. |
| `docs/plugins.md` | The tree contract | 5 | A second host applies the same mutations to cells. |
| `docs/future/ecosystem/blockers.md` | rung 2 | 5 | The terminal sandbox is the down payment. |
| `docs/future/client-plugins/07-hosts.md` | The terminal | 5 | The host exists; custody is file-backed as designed. |
| `docs/future/client-plugins/04-replaceable-surfaces.md` | each contract | 4 | The TUI is a second consumer; its defaults are providers. |
| `docs/ui-design.md` | Shell hierarchy | 4 | The terminal's shell beside the desktop's. |
| `docs/first-party-plugins.md` | per plugin | 6 | A terminal note where something is reduced or handed off. |
| `docs/future/bundle.md` | the sections in `08-deployables.md` | 7 | Rewritten to what shipped; steps reordered. |
| `docs/shell.md` | resources | 7 | The `acorn` resource and the link offer. |

## Phase 8

| Doc | Change |
| --- | --- |
| `docs/tui.md` (new) | Owns the terminal client: process model, config directory, kit on OpenTUI, chrome, keys, custody, deployables, the plugin table. |
| `docs/architecture-overview.md` | The terminal as a third client. |
| `docs/future/README.md` | `terminal/` row removed; folder added to retired folders with where its behaviour moved. |
| `docs/future/remote.md`, `docs/future/client-plugins/` | Pointers move from this folder to `docs/tui.md` (new). |
| Every inbound link | Repointed. `tools/arch/docPaths.test.ts` is the check. |
| `docs/future/terminal/` | Deleted. |
