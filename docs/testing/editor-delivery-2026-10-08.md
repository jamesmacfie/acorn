# Editor phase completion records

Date: October 8, 2026. Status: dated delivery evidence, preserved from the completed phase plans.

These notes record what each phase implemented and checked. They are not instructions to rebuild
the editor. Later phase notes can supersede earlier limits or measurements.
[Final acceptance](../future/editor/README.md) owns the remaining review and release checks.

## Phase 01: protect documents from external changes

> **Follow-up completion note — October 7, 2026.** Confirmation now captures the Node, task,
> filename, document owner, edit revision, and disk snapshot when the button arms. Reload and
> overwrite refuse a newer disk revision or changed identity; recreate remains an absence-guarded
> write. The filename appears in the confirmation prompt. One reconciliation path preserves
> CodeMirror state when an explicit reload reads the current text. Recovered drafts remain blocked
> even when disk matches their saved baseline, until a confirmed resolution. Custody counts
> overlapping suspensions, and worktree/focus/reconnect bursts queue at most one active read at a
> time. Save as checks destination custody before writing and moves source recovery only after a
> successful rebind. The client lifecycle helper owns refresh scheduling, decisions, and disk
> reconciliation; the pane still owns CodeMirror updates. Later file-operation phases must release
> each suspension holder once and use the same destination preflight before path mutations.
>
> Follow-up tests cover an intervening disk edit and tab switch during confirmation, identical
> explicit reload, matching-baseline and legacy recovery through close and retirement, overlapping
> suspension holders, burst refresh, late Node switch and task eviction reads, failed read versus
> deletion, and Save as collisions before and after the write. The Editor pane's 41 focused tests,
> custody's 10 focused tests, the editor package's 122 tests, plugin API's 14 tests, and the TUI
> package's 676 tests (2 skipped) passed. Lint and architecture checks passed. Client-core had
> 2,464 passes and two failures; the same failures, plus the earlier Node golden-route and desktop
> activation snapshot failures, reproduced with narrow tests on an untouched archive of parent
> commit `bf1143d08`. This is parent-commit evidence, not a claim about unchanged main. The isolated
> desktop Recreate prompt showed the filename and retained the draft; the isolated terminal
> navigation flow passed. The desktop driver cannot automate native dialogs or child webviews.
> External writers remain outside Acorn's path locks. No full repository suite was run in this phase.

> **Completion note — October 7, 2026.** Landed revision-bearing Editor file reads and guarded
> saves, canonical-path serialization for Editor writes, custody suspension and recovery baselines,
> active and cached document revalidation, and explicit conflict, deletion, read-failure, comparison,
> reload, overwrite, recreate, and save-as flows. Existing file-list and host-document routes remain
> unchanged. A missing revision now fails closed, so an older Node requires an update before this
> Editor can save. A null revision is reserved for explicit creation; existing-file overwrites use the
> revision shown when the person confirms. Recovery records without revision metadata require a
> deliberate resolution. The Editor filesystem bridge loads on first request to keep the Node's
> service bundle within its size budget. Later file-operation phases should use the pool's narrow
> suspend/rebind/retire operations and acquire descendant locks in sorted canonical-path order.
> External CLI and terminal-editor writes remain outside these locks, so the final hash check and
> write cannot provide an atomic compare-and-swap against them. External changes without an Acorn
> worktree event become visible on focus or explicit reload.

> **Verification.** `pnpm test --filter=@acorn/plugin-editor` passed 112 tests;
> `pnpm test --filter=@acorn/node-core` passed 1,633; `pnpm test --filter=@acorn/tui`
> passed 676 with 2 skipped using the staged Node 24.21 runtime. The database, workflow, and
> plugin API suites passed together. The focused custody test passed 9 tests. The architecture
> suite and lint passed. Full client-core had 2,463 passes and two parent-baseline failures
> (workspace route classification and CSS token count). Full Node had 272 passes and one parent-baseline
> golden-route failure for terminal task setup. The desktop package suite built and ran 171 passing
> tests; 11 client activation snapshots failed on parent-baseline terminal, agents, and changes
> contributions. The isolated desktop driver showed a preserved draft,
> conflict comparison, and a deleted-file draft restored after restart; screenshots are in
> `.acorn/agent-dev/phase01-document3/screenshots/`. The isolated terminal `tui-navigation` flow
> passed; its report is under `.acorn/agent-dev/tui/phase01-tui/reports/`. The desktop driver cannot
> reach native dialogs or child webviews, so Save as and PTY behavior were checked through routes,
> focused tests, build/import gates, and the terminal driver rather than native dialog automation.

## Phase 02: manage files from the tree

> **Completion note — October 8, 2026.** Task-addressed create, rename, and move-to-trash routes
> now rederive roots and entry identities on the owning Node. File and folder operations suspend
> captured open and persisted descendant drafts before a menu can change focus, join admitted saves,
> reserve destination custody before mutation, and keep their suspension through local reconciliation
> even if the dialog closes or the pane retires. Rename moves recovery, text, view state, and tabs;
> trash requires deliberate saves of every dirty descendant and retires their old callbacks. Same
> kind external replacement is refused using a stable entry ID separate from ctime-sensitive
> freshness. The Node serializes Editor writes and file actions across checkout aliases, checks
> external editor PTYs, protects Git metadata and the root, and handles leaf symlink entries.
>
> **Decisions and limits.** macOS uses `/usr/bin/trash`, Linux uses `gio trash`, and Windows reports
> trash unavailable; there is no permanent-delete fallback. Node has no exclusive `fs.rename`, so
> a small helper calls macOS `RENAME_EXCL` or Linux `RENAME_NOREPLACE`. The Node build produces its
> binary and manifest, and existing desktop and standalone staging copies them. Ordinary renames
> never compile C on the running host. An unavailable helper disables Rename and the route fails closed.
> Case-only rename uses a temporary sibling and reports its actual path if rollback fails. A
> successful trash adapter exit is checked against source disappearance. macOS file and folder trash
> were exercised through the route; the protected `~/.Trash` could not be listed in this sandbox.
> Linux GIO and remote hosts were unavailable for a live adapter check.
>
> **Verification.** Custody and file-action tests cover delayed writes, late document acquisition,
> closed recovery, same-kind replacement, no-clobber destination races, and an in-flight Node switch
> with the same task ID on both Nodes. The isolated desktop driver created a file, canceled inline
> rename with Escape, renamed with Enter, and moved it to Trash; screenshots showed tree and tab
> reconciliation. In an isolated terminal at 80×24 and 120×40, focus reached the tree, F2 opened
> the name field, Escape canceled, Enter renamed, Shift+F10 opened the full action menu, Ctrl+N
> opened root creation, and create/trash confirmation and cancel restored focus to surviving rows.
> Key trace showed F2 and Shift+F10 matched and were handled on the focused row. At 80×24 list and
> detail stack so the tree remains reachable. Package tests: TUI 678 passed/2 skipped; Editor 144
> passed/1 skipped; plugin API 14 passed; client-core 2466 passed with 2 previously reproduced
> parent-baseline failures; Node 272 passed with 1 previously reproduced parent-baseline golden
> failure; desktop 171 passed with 11 previously reproduced parent-baseline activation snapshot
> failures. Architecture 87 passed. Affected package lint passed. No unfiltered repository suite ran.
>
> **For later phases.** Keep counted custody holds and destination reservations until the Node
> result and local reconciliation finish. A partial Node or local result leaves drafts write-blocked
> with an actual-path recovery message. Remote device drafts remain a phase 01 reconciliation matter;
> local Trash is never assumed to represent a remote Node. Plugin resource-action registration and
> preview renderers remain outside this phase.

## Phase 03: show Git status beside files

> **Completion note — October 8, 2026.** Editor shows one Changes-owned Git status
> snapshot per task in file rows, folder counts, and open tabs. The public
> `editor:file-status` Node point returns only paths, status, scope, and rename source.
> Changes reuses its porcelain parser and the shared worktree status cache; Editor
> groups distinct paths and gives conflicts priority. A Solid memo projects each
> snapshot once. File actions and successful saves refresh it directly, alongside
> worktree events, reconnects, and focus. Plugin roster changes clear marks before
> rereading. A missing provider or non-Git folder has no marks; transient failures
> retain the last snapshot with a stale explanation. Node, task, provider, and read
> revisions fence late results. Disk revision reads still decide whether a deleted
> document can save.
>
> **Decisions and limits.** A deleted open tab can show `D`; the tree does not add
> an absent file row. The status-only read runs no numstats, patches, or per-file
> Git commands. Worktree status reads use canonical checkout paths so aliases share
> one cache entry, and invalidation drops a pending entry. The kit owns tab badge
> styling; Editor owns Git grouping. The proposed `editor:file` annotation point
> has not shipped, so this phase keeps its narrow status point. The terminal's
> three-column 120×40 layout clips long inline tree status explanations, while
> retaining the letter, folder count, and file controls. The active document tab
> prints its full status text. Provider disablement through Settings takes effect
> after a Node restart, as Settings states; the reader also handles a live roster
> change immediately. Later UI work can give a focused tree row a wider detail
> line without changing the Git provider contract. The Node service build is
> 3,149,676 bytes against a 3,150,000-byte ceiling; later phases should keep
> optional work lazy rather than adding it to service startup.
>
> **Verification.** Temporary Git repositories covered staged addition, both
> modification scopes, untracked files, rename source, deletion, unresolved
> conflict, and a non-Git folder. Reader and route tests covered transient failure,
> provider retirement, late responses, and Node switches. Two readers of 10,000
> untracked files used one status subprocess in 73 ms; 500 map lookups took 4 ms
> without reprojection. The 10,000-row virtual tree stayed under 100 mounted rows;
> the shared Rows scroller stayed under 40 after a scroll. The isolated desktop
> fixture showed file and folder marks and an open tab in light and dark captures
> (`.acorn/agent-dev/phase03-status-desktop/screenshots/editor-light-open.png` and
> `editor-dark-open.png`). After Changes was disabled and the isolated Node
> restarted, Editor still listed files with no Git marks. Live terminal snapshots
> at 80×24 and 120×40 showed counts and file letters; at 80×24 the modified row
> showed its full unstaged label. The terminal host tab contract has a separate
> status-and-dirty-dot test. Editor passed 152 tests (1 skipped), Changes 271
> (1 skipped), Node core 1,636, plugin API 14, protocol 294, and TUI 679
> (2 skipped). Lint passed 37 tasks and architecture passed 87 tests. Client core
> had 2,467 passes and the two failures previously reproduced on untouched
> `bf1143d08` (workspace route classification and CSS shadow-token count).
> Desktop had 171 passes and the 11 activation snapshot failures previously
> reproduced on that untouched parent. Those are parent-commit checks, not a
> claim about main. No unfiltered repository suite ran in this phase.

## Phase 04: manage tabs and navigate files

> **Completion note — October 8, 2026.** Editor now distinguishes duplicate basenames with the
> shortest parent suffix. Each tab has an inactive-target menu for keeping a preview, guarded single
> and ordered bulk close, path copy, and tree reveal. Bulk close captures tab generations, asks the
> existing custody guard to save each target, supports cancellation, stops on an edit or failure,
> and reports a live owner's partial result. Reopen retains the last 20 successful explicit closes
> per Node/task session as path and tab-order index only; reopened tabs are kept. A separate 100-place
> Node/task session history records deliberate file switches and jumps, replays without recording,
> branches after back, and skips confirmed missing files with a notice. Rename and trash reconcile open
> and closed references after the captured owner's successful operation.
>
> A follow-up fences pending replay and reopen reads against newer navigation and metadata path
> changes. Transient read failures leave history and closed entries retryable; only a confirmed
> missing reopen target is removed. The selected tab menu releases its counted custody hold before
> invoking guarded close.
>
> Empty quick open puts up to 50 valid device-recent activations before the deduplicated listing;
> nonempty queries keep whole-path fuzzy ranking. Exact colon-bearing filenames win before parsing
> positive one-based `:line[:column]` suffixes. Selection is fenced to the palette's captured
> Node/task and uses a retained reveal with clamped cursor placement. Desktop browser storage and
> the terminal host's file-backed device preference adapter store recency at the address documented
> in [scope rules](../state-ownership/scope-rules.md); task archive and Node removal prune it.
> Editor owns metadata, document custody owns text and saves, and the kit only presents optional
> tab menus. The planned canonical resource-action tab target has not shipped, so the adapter stays
> private to Editor. Terminal-session tabs retain their existing controls. Focused reopen and
> back/forward chords use the host keymap, including the terminal drawer's separate reopen chord.
>
> **Verification and limits.** Pane tests cover delayed save, replacement-tab identity, bulk
> failure/cancellation with newer tabs, replay branching, and positioned reveal. Desktop snapshots
> and screenshots in `.acorn/agent-dev/phase04-tabs-desktop/screenshots/` show an inactive README
> menu while another file stays active, a reopened kept tab, and the corrected line-12 column-4
> cursor (`quickopen-position-fixed.png`). Native Cmd+P, Alt+Left/Right from tab focus, and
> Cmd+Shift+T reached the Editor commands. TUI driver snapshots at 80×24 and 120×40 show quick
> open and the live inactive-tab target: Left moved the menu caret to `module-0013.ts` while
> `module-0014.ts` stayed active, and Shift+F10 opened the former's menu. The 80×24 menu scrolled
> to **Reveal in file tree** with Down; 120×40 displayed every action. Escape returned focus to the
> strip, and **Keep open** allowed a second tab without preview replacement. `ACORN_TUI_KEYS_TRACE`
> showed the Editor detail region receiving the tab-strip stop. A normal click activates a tab;
> its adjacent `⋯` targets the inactive tab's menu. The TUI driver does not expose a graphical
> cursor. Native dialogs and child webviews are outside the
> driver. A live desktop bulk-close attempt with an unwritable fixture parent closed all three
> tabs; it did not induce a save failure, so partial failure is verified by the pane test only.
> Follow-up pane tests use delayed reads to show that newer deliberate navigation and later replay
> win; they also cover transient retry, stale reopen, and dirty close from a held menu. Editor passed
> 171 tests (1 skipped), TUI 682 (2 skipped), plugin API 14, terminal 199,
> and protocol 294 and Node core 1,636 from unchanged shared-cache inputs. Client core passed
> 2,468 and retained the two known workspace-route and CSS shadow-token failures; desktop passed
> 171 and retained its 11 activation snapshot failures. Full lint passed 37 tasks and architecture
> passed 87 tests. These two existing client-core failures and 11 desktop snapshots also appear in
> the prior phase's completion record. Later work can add a live guarded-save failure fixture;
> this phase's pane test covers that behavior.

## Phase 05: expose editing controls and state

> **Follow-up — October 8, 2026.** The status strip now follows the active graphical document,
> image preview, or PTY at the stable bottom of Editor. A typed kit status variant supplies primary,
> essential, secondary, and action slots; its CSS no longer selects English labels or child order.
> The full relative path is kept in the label and tip, with width-based clipping. Position and
> custody save state remain visible at 800 px; Details retains secondary facts. Selection length
> sums CodeMirror ranges in UTF-16 units without copying large selected text. Status menus close on
> tab change, and held callbacks are fenced by the current task, Node, tab, and graphical admission
> where they change presentation defaults.
>
> Owner tests now exercise live registered commands and save routing, search and markers across
> reconfiguration, dirty undo and remount, manual indentation with CRLF, a million-unit selection,
> and stale status actions. Editor passed 183 tests (1 skipped), TUI 684 (2 skipped), plugin API 14,
> architecture 87, and lint 37 tasks. Client core passed 2,468 with its two previously reproduced
> workspace-route/CSS-token failures; desktop built and passed 171 tests with its 11 previously
> reproduced activation snapshot failures. Isolated desktop screenshots inspected after the move:
> `status-bottom-light.png`, `status-bottom-wrapped.png`, `status-bottom-narrow.png`, and
> `status-bottom-dark.png` in `.acorn/agent-dev/phase05-controls/screenshots/`. The isolated TUI
> showed README's available path, Details, Copy path, and Markdown facts at 80×24 and 120×40;
> it did not claim a cursor or save state. The full unfiltered repo gate remains for the coordinator
> after phase 06.
>
> **Completion note — October 8, 2026.** Editor now presents relative path, cursor position,
> language, inferred or chosen indentation, nonempty aggregate selection length, and custody save
> state in a compact strip. The path has explicit copy and tree reveal actions. A narrow strip hides
> secondary facts in Details while retaining position and save state. Save failure keeps its detailed
> banner and offers Retry save through custody; changed or deleted disk content and recovered drafts
> keep their existing resolution actions. PTY and read-only previews show only facts they own.
>
> Word wrap defaults off at device scope and can be overridden per open document for the session.
> A CodeMirror compartment reconfigures the admitted graphical document without changing text or
> its undo history. Indentation uses the first 200 lines and at most 64 KiB, preferring consistent
> two-, four-, or eight-space steps or tabs; ambiguous samples use the device default of two spaces.
> Manual mode and width affect subsequent indentation and tab display only. Presentation overrides
> follow successful folder or file rename and are pruned with their task or Node. Focused host
> commands use the live admitted document for find, replace, line operations, comment, next match,
> undo/redo, and indent/outdent. Go to line retains the phase 04 command and history path. The
> shared find panel is still future work, so these commands invoke CodeMirror's search panel.
> The engine remains lazy and the kit has no CodeMirror dependency.
>
> **Verification and limits.** The Editor suite passed 178 tests (1 skipped); TUI passed 682
> (2 skipped), protocol 294, plugin API 14, architecture 87, and lint passed all 37 tasks. Client
> core passed 2,468 and retained its known workspace-route and CSS shadow-token failures. One
> telemetry test failed only in an earlier concurrent package run and passed in a focused rerun;
> the final package run had only the two known failures. The isolated desktop build showed a clean
> Saved file, recovered draft, inferred indentation, and checked Word wrap with visibly wrapped
> JSON lines. An external disk edit produced a real Changed on disk conflict and preserved the
> local draft. The live save-failure banner was not induced; custody and pane tests cover failure
> and retry. Final screenshots in `.acorn/agent-dev/phase05-controls/screenshots/` show the strip
> at a narrow width in dark and light themes (`status-narrow-final.png`, `status-light-final.png`),
> wrapped text (`wrapped-final.png`), and the focused palette command
> (`palette-focused-final.png`). TUI built with all 49 runtime imports resolved and rendered at
> 80×24 and 120×40; its editor detail was exercised by the TUI package suite. The final unfiltered
> repository gate remains with the coordinator after phase 06.

## Phase 06: scope search and finish acceptance

> **Follow-up completion note — October 8, 2026.** Both ripgrep passes use joined bounded cleanup;
> regex validation survives empty filters, and scope/pattern replacement is debounced after abort.
> Live Node/task tree capture, mounted-folder availability, listing/read tokens, reveal fences, and
> the public host viewport seam protect stale work and retain the actual result reading place.
> Filtered searches use three ripgrep processes: default/glob filename intersection and filtered text.
> The fixture includes a valid large image and staged/conflicted Git states. Connected local desktop
> and terminal controls, restart/rename/recovery, and measured counts/bounds are recorded in the
> [follow-up evidence](./editor-phase06-follow-up-2026-10-08.md), with exact package results.
> Remote/platform/native-dialog checks remain unavailable. Coordinator integration, whole-branch
> review, and the unfiltered repository gate remain pending; this task does not run the full gate.

> **Implementation note — October 8, 2026.** Editor search accepts a task-confined folder and
> validated include/exclude globs, retains task-scoped search state through hiding and remount, and
> fences stale requests and result navigation. A bounded ripgrep file-list pass applies glob
> precedence before the ordinary text search, preserving default hidden and Git-ignore behavior.
> This requires two ripgrep processes when filters are present. The Node owns both processes and
> terminates them on cancellation. Scope rename/trash requires an explicit reset.
>
> The tree shows Git-ignored entries by default, labels them accessibly, and can hide or temporarily
> reveal them without closing open documents. Git metadata is requested in bounded batches for
> listed directories through the public Git owner API. Collapse all clears descendant expansion.
> Search and tree commands use captured task context and shared typed kit targets. The Editor search
> bridge loads lazily; the Node static bundle is 3,145,174 bytes against a 3,150,000-byte ceiling.
>
> **Verification and limits.** See [dated phase 06 evidence](./editor-phase06-2026-10-08.md).
> Editor passed 194 tests (one skipped), Node app 273, Node core 1,636, plugin API 14, TUI 684
> (two skipped), desktop built suites 182 JS, 10 boot, and 65 Rust, architecture 87, and lint 37
> tasks. Client core passed 2,468 with two workspace-route/CSS-token failures also reproduced on
> untouched older parent `bf1143d08`. The desktop driver exercised scoped filtering, result
> navigation, ignored visibility/reveal, and collapse on a 10,000-path disposable fixture. Terminal
> Editor navigation, remote/platform/native-dialog checks, quantitative runtime bounds, and the
> connected six-phase restart flow remain unverified. The full unfiltered `pnpm test` gate is
> pending with the coordinator after integration.
