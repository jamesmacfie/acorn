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

## Done in phase 0 (2026-08-31)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/future/terminal/findings.md` | new file | What phase 0 found, which decision each finding moves, and which later phase owns the fix. |
| `docs/ui-design.md` | The closed kit | `HOST` is supplied per host package at build time; `dom` and `tui` exist and which is which. |
| `docs/ui-design.md` | What a terminal renderer needs from this | The `tui` column is read by the nodes the spike drew, tested for presence for the rest. Points at the findings. |
| `docs/testing.md` | Test layers | The `tui` suite: what it renders, what it asserts, and why it skips without `node:ffi`. |
| `docs/future/terminal/README.md` | Decisions taken, The files, The phases, The order of work | The Node 26.4 floor as a decision of its own; the findings row; phase 0 marked shipped. |
| `docs/future/terminal/02-survey.md` | OpenTUI row | The Node floor and the flag, and that OpenTUI's Node lane is Linux x64 only. |
| `docs/future/terminal/08-deployables.md` | What changes in `bundle.md`'s claims | Bundling the runtime is a precondition, not a last step; `bin/acorn` passes the flag; prebuild parity is not proven. |

No kit dishonesty was found, so no owning section of `docs/ui-design.md` changed for that reason. Every
finding that needed a fix needed it in the host or in the pane registry, not in the kit.

## Done in phase 1 (2026-08-31)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/ui-design.md` | The closed kit | A `reduced` row names its loss beside its level; both hosts draw the whole kit and `kitTable.test.ts` holds the two tables to the matrix. |
| `docs/ui-design.md` | What a terminal renderer needs from this | The `tui` column is read rather than tested for presence; `roleCell()` beside `roleVar()`; a role names a colour slot and the appearance layer resolves it. The one prop the kit lost, `Markdown`'s `onClick`. |
| `docs/ui-design.md` | Every node at 80 by 24 | Seven rows made honest: `Row`'s `reveal`, `Timeline`'s `follow`, `Rows`' window, `Markdown`'s links, `Icon`'s glyph table, `TableHead`'s note, `CopyButton` over OSC 52. |
| `docs/testing.md` | Test layers | One cell-buffer case per node, the two whole-pane sizes, and the two files that never skip. |
| `docs/future/terminal/README.md` | The phases, The order of work | Phase 1 marked shipped; what it left for phase 2. |
| `docs/future/terminal/phase-1-kit-complete.md` | What shipped, and where it differs | Four departures from the plan, and the two things deliberately left for phase 2. |

## Done in phase 2 (2026-08-31)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/panes.md` | Layout model | The component table is the host package's and reaches the registry through `layouts/table.ts`; the terminal projections are built rather than written; a handle is a key in a terminal; the two document splits' projection corrected. |
| `docs/command-palette-and-shortcuts.md` | Focus and typing | The terminal adapter is used and what a target is per host; regions without a DOM and the two rules a host with no pointer adds; `collectionIntents.ts` beside `collection.ts`; the trap and the double-Escape rule. |
| `docs/terminal.md` | Client | The `pty` rectangle in a terminal, what it hands its caller instead of an element, and why the plugin's own surface has not moved yet. |
| `docs/testing.md` | Test layers | The layout suite and the keys twin. |
| `docs/future/terminal/findings.md` | What phase 2 did with these | Five findings closed, six new ones. |
| `docs/future/terminal/phase-2-layouts-keys-focus.md` | What shipped, What this phase deliberately left | Six departures from the plan, and the two plugin callers that wait for phase 4. |
| `docs/future/terminal/README.md` | The phases, The order of work | Phase 2 marked shipped; what it left for phases 4 and 6. |

## Done in phase 3 (2026-08-31)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/node-distribution.md` | Reaching a node with `acorn` (new) | What `acorn` opens, how it chooses between attaching and starting, where its device tokens live, and what `--node` does. |
| `docs/security.md` | Transport and auth | The bearer on the `/v2/events` upgrade: why the desktop needs a helper to set it, why the terminal does not, and the arch rule that stands in for the process boundary. |
| `docs/testing.md` | Test layers | The TUI boot test: what it runs for real, the three questions only this host answers, and why it never skips. |
| `docs/caching.md` | Renderer query cache | Where a partition is written is the host's, through `setCacheStorage`; IndexedDB is the default and the terminal installs files. |
| `docs/future/bundle.md` | The snags | The pairing-window command is still a door after phase 3; the TUI's own token file joins the list of things NTFS does not give the modes to. |
| `docs/future/terminal/findings.md` | What phase 3 did with these | Two findings closed, six new ones. |
| `docs/future/terminal/phase-3-process-and-auth.md` | What shipped, What this phase deliberately left | Five departures from the plan, and the three things it left for phase 4. |
| `docs/future/terminal/README.md` | The phases, The order of work | Phase 3 marked shipped; what it left. |

Unchanged as the phase predicted: `docs/node-enrollment.md`, because the loopback mint route was not
built.

## Done in phase 4 (2026-08-31)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/ui-design.md` | Shell hierarchy | The terminal's shell beside the desktop's: what is in the cycle, what is drawn and not focused, and which surfaces go through the exclusive-slot registry. |
| `docs/command-palette-and-shortcuts.md` | Focus and typing | The footer as a view of the active layers; the region cycle being the screen on a host that draws one pane; Tab beside F6; the primary modifier as a host's answer rather than the platform's. |
| `docs/future/client-plugins/04-replaceable-surfaces.md` | Who draws each surface | The terminal is the second consumer, and its defaults reach the reader through the same registry. |
| `docs/testing.md` | Test layers | The chrome suite: what it drives and the two whole-screen sizes. |
| `docs/future/terminal/findings.md` | The screenshot, What phase 4 did with these | The frame redrawn with a shell around it; four findings closed, four new ones. |
| `docs/future/terminal/phase-4-chrome.md` | What shipped, What this phase deliberately left | Eight departures from the plan, and the five things it left. |
| `docs/future/terminal/README.md` | The phases, The order of work | Phase 4 marked shipped; what it left for phases 5 and 6. |

## Done in phase 5 (2026-08-31)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/security.md` | Trust boundaries | The terminal client as a fifth entry: the first two boundaries collapsed into one process, held as a module boundary and an arch rule, with the plugin's own realm the one that did not move. |
| `docs/security.md` | Third-party plugin bundles | The terminal hashes its own bytes with the same two stores under its own config directory; the sandbox is one of three rather than one of two. |
| `docs/security.md` | The containment ladder, rung 0 | The third container: a worker thread under `--permission`, why its grants are its own, the network hole Node's model leaves and the module deny list that closes it, and why a grant is a real path. |
| `docs/security.md` | The containment ladder, rung 2 | The down payment: which three of rung 2's open questions the terminal sandbox settled, and what is left. |
| `docs/security.md` | Summary table | One row: the terminal's device token and consent files. |
| `docs/plugins.md` | The tree contract | A second host exists and applies the same mutations to cells; the batch rules live in one module both hosts import; a batch is coalesced per host rather than per animation frame. |
| `docs/future/ecosystem/blockers.md` | gate 1, the designed answer | The terminal sandbox as rung 2's down payment, and the three questions it answered. |
| `docs/future/client-plugins/07-hosts.md` | The terminal | The host exists; its custody is the design rather than a variation; checklist items 1 and 2 held on a second host; a device-held install is still this folder's phase 0. |
| `docs/testing.md` | Test layers | The plugin suite: what it starts for real, what it asserts about containment, and the one case in it that skips. |
| `docs/future/terminal/findings.md` | What phase 5 did with these | One finding closed, eight new ones, three things deliberately left. |
| `docs/future/terminal/phase-5-loaded-plugins.md` | status, What shipped | Five departures from the plan, and the three things it left. |
| `docs/future/terminal/README.md` | Decisions taken, The phases, The order of work | The worker thread as a decision of its own; phase 5 marked shipped; what it left. |

## Done in phase 6 (2026-08-31)

| Doc | Section | Change |
| --- | --- | --- |
| `docs/terminal.md` | Client | `attachPty`: what a caller says about a PTY and what each host draws, why the drawer surface keeps its own xterm, and the `$EDITOR` handoff needing nothing built. |
| `docs/editor.md` | Editing in your own editor | The same preference is the terminal client's whole handoff; what that host does not have is the graphical side. |
| `docs/first-party-plugins.md` | What each of these loses in a terminal (new) | One row per plugin that loses something, and the four that reach this host as a tree bundle instead. |
| `docs/ui-design.md` | Role tokens | A space role answers both axes; `row` and `stack` are one cell horizontally. |
| `docs/ui-design.md` | What a terminal renderer needs from this | `attachPty` fills a `pty` rectangle; a prop type is declared once and both hosts compile against it; nothing in the kit shrinks. |
| `docs/ui-design.md` | Every node at 80 by 24 | Five rows: `Timeline.Turn`, `Modal`'s compound spellings, `ListDetail`'s two forms and its narrow stack, `Row`'s `stacked` variant, an icon-only `Button` drawing its label. |
| `docs/panes.md` | Layout model | The `ListDetail` node's two forms, and which one a remote tree can use. |
| `docs/plugins.md` | The plugin API | `attachPty` on `/ui`; the per-device storage helpers on `/client`. |
| `docs/testing.md` | Test layers | The pane suite: what it opens, the three questions it asks, and why each case waits for its own string. |
| `docs/future/terminal/01-why.md` | What a terminal client gets, and does not | Three rows corrected — editor, terminal, preview — and a paragraph on what the sweep found reading the table. |
| `docs/future/terminal/findings.md` | The screenshot, What phase 6 did with these | The frame redrawn with the whole roster; one finding closed, fifteen new, three things left. |
| `docs/future/terminal/phase-6-panes-sweep.md` | status, What shipped, What this phase deliberately left | Seven departures from the plan, and the three things it left. |
| `docs/future/terminal/08-deployables.md` | What `pack-node.mjs` grows | The twenty-four packages the bundle leaves external now, and the count phase 7 owes. |
| `docs/future/terminal/README.md` | The phases, The order of work | Phase 6 marked shipped; what it found and what it left. |
| `tools/arch/docPaths.test.ts` | the link check | Fenced blocks are skipped, because the avatar and chip a terminal screenshot draws around an author name read as a link to this check. |

## Owed by phase 7

| Doc | Section | Phase | What it says afterwards |
| --- | --- | --- | --- |
| `docs/node-distribution.md` | reaching a node | 7 | `bin/acorn` in the tarball layout. |
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
