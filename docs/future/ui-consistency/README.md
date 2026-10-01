# UI consistency: the rest of the pass

**Status:** in progress. Eleven of twenty-one batches shipped on branch `ui-inconsistency`, uncommitted
when this was written. Nine area batches and the final sweep remain. Written 2026-10-01.
Line numbers in these files are from 2026-10-01 and may have moved.

This programme is a UX and UI consistency pass over the acorn desktop app. The worry behind it was that
there were too many different components and patterns doing the same job. The goal is that the same
kind of thing looks and behaves the same way on every page: page headers, sections, setting rows,
toolbars, tabs, empty states, list and detail, form fields, and button sizes. It also judges every
piece of helper text: remove it, move it behind a help mark, or keep it inline and make it plain.

Twelve review areas produced 245 findings. A fix plan put each one into a batch or the deferred list.
The kit batches went first, so the area batches build on them. The review files, the plan, and the
change log lived in a gitignored folder and are not in the repo; this folder holds everything a later
session needs.

## Files in this folder

- [house-patterns.md](./house-patterns.md): the yardstick. The scales and the role-by-role patterns, as
  the kit batches left them, plus the plan's decisions and the lead's overrides.
- [deferred.md](./deferred.md): everything deferred, why, and the product decisions that need a
  person. It plays the role a `refused.md` plays in other programmes.
- One folder per remaining batch, one file per finding, named `<id>-<slug>.md`. Each file says what is
  wrong, where to see it, the fix with files and lines, its copy changes, what earlier batches already
  did or provide, and how to check it.

## What shipped

**K1a, controls, buttons, and rows.** The settings switch is 32 by 20. Buttons in every chrome bar are
sm, except in a bar that holds an input. Every row of buttons is `--gap-row` apart. Inline alerts lost
their outer margin and put buttons in `actions`. Tab focus rings read the focus tokens. A bare text
button in an action row is 26 high. `ConfirmButton` keeps its width when armed, and every call site
says "{Verb} {thing}?". Buttons and segmented controls no longer stretch in a `Stack`, a settings
section, or a stacked `Field`. Row meta shrinks and caps at half the row. A file name keeps its width.
`RowActions` hides until needed. The key-value grid has its columns. `Fold` gained a `leading` slot, and
the `x` icon is in the eager set.

**K1b, setting rows, sections, and tables.** A setting row has a title line: the label, the changed dot,
the scope badge, then **Saved** or **Reset**, so the control column never changes width. Hand-rolled
chips became `Badge`. One control column token, `--setting-control-w`. Settings spacing moves with the
style pack. Every inline row is the same height. Sections are separated by a gap and a divider, and the
search landing highlight reads a new token. Rows stack on a narrow page. Table row labels read as text.
`TableRow` ignores a click on a control inside it. An unlabelled checkbox can be md. `Text` draws at
12px for every emphasis, and the agent transcript keeps its size.

**K2, the pane frame.** Every chrome bar paints `--bg-subtle`; the top bar keeps `--bg`. A list column
has one left edge. Home's title matches the other pages. The heading-level rule, the group label look,
and the empty-state rule are written in `docs/ui-design.md`. Only pane and group headers stick. The
collapse control no longer covers headers. Tab strips that scroll fade their edge. Settings tabs sit
flush. Remote-tree panes reach their edges. Scrolling list columns stop padding twice. It added
`DetailColumn measure="page"` and `--page-measure`, and put back two style tokens K1b had removed, so
older style packs still validate.

**K3, the help mark and tooltips.** `help` on `SettingRow`, `SettingsSection`, `SectionHeader`,
`Section`, `Heading`, and `Field` draws a "?" whose text opens on hover, focus, or tap. The rule for
`description` against `help` is in `docs/ui-design.md` § The help mark. A `Field`'s and a setting row's
label is a real label for its control. Kit nodes route `title` to the styled tip, which flips and clamps
at the window edge. `IconButton`'s tip defaults to its label. `Badge tip` and `StatusDot tip` exist.
Harnesses and defaults was the first page to move its text into help.

**K4a, the overlay kit.** Modal titles are 15px in a 48 bar with a close button, and a modal names
itself and moves focus inside. The footer has a divider and the pane pad. `Picker` remove arms before it
deletes (`removeLabel`). Destructive menu items sit last below a separator. `Menu.Item` takes `checked`
and `kind`, and the terminal menu gained `Menu.Label` and `Menu.Separator`. Floating surfaces read one
token set. Menus are at least 10rem. Popover headers are group headers. The icon picker reads names as
words. Toasts sit top right everywhere. The wizard footer owns every action through new `LayoutProps`.
A tree `Button` with only a label shows it, and numbers render in tree text.

**K4b, one dialog shape.** The dialog rule is in `docs/ui-design.md` § Chrome and overlays, and fifteen
dialogs follow it. The archive confirmation is a `Modal` alert dialog, says whether acorn owns the
worktree, and the rail button reads **Archive task**. The config trust dialog, the plugin approval
dialog, and New task and Rename moved onto `Modal`. The page-form rules are in `docs/frontend.md`
§ Forms and flows. The reference panel handles Escape and focus. Dialog titles no longer end in "?".

**K5, plugin names.** The node's plugin row carries an optional `label`, from the manifest name or the
compiled plugin's definition. `pluginLabel` in `@acorn/plugin-api/client` returns it, or the id. The
Installed list, plugin pages, the plugin strip, shortcuts, settings search, Tools and permissions, Rail
and surfaces, custom agents, schedules, run history, storage, telemetry, and the bell show names.

**B01, onboarding.** The step body scrolls with an inset, the step indicator is numbered, and the dialog
has one height with no box inside a box. `Inline even` lays out choice cards. The naming card, the
blank-name check, the added-projects tally, the AI key form, and the shortcut list were reworked.
Finishing lands on the first project. The GitHub card hides when the build cannot sign in.

**B02, shell chrome, palette, and notifications.** The pane switcher marks the pane on screen. The top
bar names the project and task. Top bar, pane pin and close, terminal drawer strip, task footer, and
rail controls were sized and worded. Archive, the bell, the workspace picker, and error and gate states
use the house states. The palette's rows and frames were reworked. `formatChord` is the one way to
write a chord. The shortcuts sheet groups by owner.

**B04, the settings frame and device pages.** The plugin strip is styled on a direct visit. The page
header has a linked path eyebrow, the title with its scope badge, and a close button. Keyboard
shortcuts, Notifications, Command line, Device config, Clear cache, Docker, Extension points (layout
only), and the Style gallery were reworked. Search results read page › section, and search finds a
plugin by its id through `keywords`.

**B05, workspace, project, and node pages.** Every page is 720 wide. Schedules show their controls.
Renaming a node writes once. The Nodes page is a list of stacked rows with a boxed pairing form. The
project table uses `TableRow` and `formatPath`. Config-file copy moved into help. Read-only facts line
up. Headings that restated their page were renamed. Ids in prose became names.

None of the 99 remaining findings was fully done by an earlier batch, so every one has a file. Where an
earlier batch did part of one, its file says so under **Already done** and drops that part.

## What remains, in order

Run the batches in this order. Each depends on the kit batches; B07b depends on B07a, B08b on B08a, and
B10b on B10a.

### B06. Settings: integrations and plugins

- [06-1. Tools and permissions shows people text written for the model](./b06-integrations/06-1-tool-descriptions-for-the-model.md)
- [06-3. Lists of things take seven shapes, and status shows five ways](./b06-integrations/06-3-one-list-row.md)
- [06-4. Limits and cost: the price tables leave the page](./b06-integrations/06-4-limits-and-cost-tables.md)
- [06-5. Five add-and-edit forms, three field layouts, three button orders](./b06-integrations/06-5-add-and-edit-forms.md)
- [06-6. A plugin's page puts its tabs in the middle, and one tab is often empty](./b06-integrations/06-6-plugin-page-layout.md)
- [06-8. MCP: two pages that explain each other, and a hand-built server list](./b06-integrations/06-8-mcp-pages.md)
- [06-9. The HTTP variable editor uses raw kind words and a far-away add button](./b06-integrations/06-9-http-variable-editor.md)
- [06-10. Services and AI models: a section that only points away, and a page with the wrong title](./b06-integrations/06-10-services-and-ai-models.md)
- [06-11. The Add connection gallery: titles at three heights, and faint text](./b06-integrations/06-11-add-connection-gallery.md)
- [06-12. Links to another settings page come in four looks](./b06-integrations/06-12-links-to-other-pages.md)
- [06-14. Rail and surfaces repeats its section's sentence on every row](./b06-integrations/06-14-rail-and-surfaces.md)
- [06-17. The custom agent form: small selects, a typed icon name, and an echoing section](./b06-integrations/06-17-custom-agent-form.md)
- [06-18. Smaller defects on the integration pages](./b06-integrations/06-18-smaller-defects.md)

Rebuild the findings, http, sentry-telemetry, and model-providers bundles to see their changes.

### B07a. Workflows: editor

- [07-2. The workflow editor's header is a 26-pixel row with no bar](./b07a-workflow-editor/07-2-editor-header.md)
- [07-5. The graph: tiny targets, text that shrinks past reading, and ids for names](./b07a-workflow-editor/07-5-graph-small-part.md)
- [07-6. The inspector has no header, and its small fields stretch across the column](./b07a-workflow-editor/07-6-inspector.md)
- [07-7. Every group in the inspector is an uppercase fold](./b07a-workflow-editor/07-7-folds.md)
- [07-8. The inspector says the same thing three or four times](./b07a-workflow-editor/07-8-say-it-once.md)
- [07-9. Outline rows are five lines tall, and a straight chain becomes a staircase](./b07a-workflow-editor/07-9-outline-rows.md)
- [07-10. Problems show before anyone types, twice, in one run-on line](./b07a-workflow-editor/07-10-problems-footer.md)
- [07-15. The workflow forms disagree with each other](./b07a-workflow-editor/07-15-forms-agree.md)
- [07-16. The Add step menu is one flat list in id order](./b07a-workflow-editor/07-16-menus.md)
- [07-17. Text buttons 11 pixels high, a typed "+", and a code action row on the edge](./b07a-workflow-editor/07-17-buttons.md)
- [07-19. Three status marks in the editor header](./b07a-workflow-editor/07-19-save-and-publish-marks.md)

Use the published workflow **Release check**, and add a throwaway workflow to reach every step kind;
delete it through the editor after.

### B07b. Workflows: rail, runs, and dialogs

- [07-1. The run pane lists steps by their internal id](./b07b-workflow-runs/07-1-steps-by-name.md)
- [07-3. Run surfaces print the machine's status and kind words](./b07b-workflow-runs/07-3-status-words.md)
- [07-11. After Run…, nothing says where the run went, and the rail's run rows go nowhere](./b07b-workflow-runs/07-11-opening-a-run.md)
- [07-12. The Workflows rail list: mid-list pane headers and problem rows that say nothing](./b07b-workflow-runs/07-12-rail-list.md)
- [07-13. The run pane puts its controls in three places, and its footer is a label](./b07b-workflow-runs/07-13-run-pane-controls.md)
- [07-14. The gate approval form: small buttons, a raw field name, and loose problems](./b07b-workflow-runs/07-14-gate-form.md)
- [07-18. Workflow dialogs: Publish, Run, Schedule, and AI authoring](./b07b-workflow-runs/07-18-dialogs.md)
- [07-20. One idea, several words: step, node, root, posture, tree](./b07b-workflow-runs/07-20-one-word-per-idea.md)
- [07-21. Smaller workflow defects](./b07b-workflow-runs/07-21-smaller-defects.md)

### B08a. Task panes: Changes and the diff

- [08-1. The Changes list header hides its own summary and runs under the collapse control](./b08a-changes-and-diff/08-1-changes-list-header.md)
- [08-9. What a diff line draws under itself starts at the wrong inset](./b08a-changes-and-diff/08-9-notes-under-a-diff-line.md)
- [08-11. Checkboxes mean three things in three places](./b08a-changes-and-diff/08-11-checkboxes.md)
- [08-13. The branch bar cuts the branch name and keeps the project name](./b08a-changes-and-diff/08-13-branch-bar.md)
- [08-14. "No files match." sits in the diff's corner](./b08a-changes-and-diff/08-14-file-filter-empty-state.md)
- [08-15. Empty, loading, and error states in the Changes pane take several shapes](./b08a-changes-and-diff/08-15-changes-states.md)
- [08-16. The line composer's buttons and the note badge](./b08a-changes-and-diff/08-16-line-composer.md)
- [08-17. The diff file header: a plain status letter and a tiny fold control](./b08a-changes-and-diff/08-17-diff-file-header.md)
- [08-18. Every code line in Changes carries a native tooltip](./b08a-changes-and-diff/08-18-native-tooltips-on-code-lines.md)

Everything here is CSS, attributes, copy, or a button variant. Do not change row heights,
`DIFF_LINE_HEIGHT`, the measure scheduler, or the height estimates in the diff model. Use the task
**Review changed files**.

### B08b. Task panes: Notes, Context, Findings, Memory, and Editor

- [08-5. Findings rows wrap one word per line, and every row has the same title](./b08b-document-panes/08-5-findings-rows.md)
- [08-7. The document panes do not share one frame](./b08b-document-panes/08-7-one-pane-frame.md)
- [08-8. Context: four left edges, checkboxes far from their labels, and meters that change size](./b08b-document-panes/08-8-context.md)
- [08-12. Notes: a toggle that renames itself, a footer that jumps, and emoji marks](./b08b-document-panes/08-12-notes.md)
- [08-19. Editor: "$EDITOR → agent" reads as one phrase, and code is a different size from the diff](./b08b-document-panes/08-19-editor.md)
- [08-20. Editor search: a field with no inset, tiny toggles, and paths in capitals](./b08b-document-panes/08-20-editor-search.md)
- [08-21. The memory form: misaligned fields, three words for one choice, and a toast that prints a path](./b08b-document-panes/08-21-memory-form.md)
- [08-22. The Memory page is a wall of full-width cards](./b08b-document-panes/08-22-memory-page.md)
- [08-23. The memory proposal review: four equal buttons and the machine's words](./b08b-document-panes/08-23-proposal-review.md)
- [08-24. Smaller defects in the document panes](./b08b-document-panes/08-24-smaller-defects.md)

Never add, edit, or delete a memory through the app. Render the memory form and stop.

### B09. GitHub

- [09-1. Picking another pull request leaves the previous one's diff on screen](./b09-github/09-1-stale-pull-diff.md)
- [09-2. GitHub status is machine words, drawn five different ways](./b09-github/09-2-status-words.md)
- [09-3. A failed GitHub action prints the server's error code](./b09-github/09-3-error-codes.md)
- [09-4. The merge box has no primary button, wraps, and offers the wrong verbs](./b09-github/09-4-merge-box.md)
- [09-7. A pull list row gives the title 61 of its 300 pixels](./b09-github/09-7-pull-list-rows.md)
- [09-8. GitHub's empty, loading, and error states: a mascot, corner text, and failures that say "none"](./b09-github/09-8-github-states.md)
- [09-9. A conversation thread's file link wraps and centres on two lines](./b09-github/09-9-thread-file-link.md)
- [09-10. The description's copy button sits on a line of its own](./b09-github/09-10-description-copy-button.md)
- [09-11. The overview repeats reviewers and file counts, and leaves out the review decision](./b09-github/09-11-overview-facts.md)
- [09-12. The new pull request form reads right to left and repeats itself](./b09-github/09-12-new-pull-request-form.md)
- [09-13. The GitHub importer has no frame](./b09-github/09-13-importer.md)
- [09-14. One thing, several names](./b09-github/09-14-one-name-each.md)
- [09-15. The task's PR pane says the number twice and hides that a related pull is read-only](./b09-github/09-15-task-pr-pane.md)
- [09-16. The check run dialog uppercases its steps and has no link to GitHub](./b09-github/09-16-check-run-dialog.md)
- [09-17. Smaller GitHub defects](./b09-github/09-17-smaller-defects.md)

09-1 is a correctness bug, not a looks problem: a reply can land on the wrong pull request. Do it first.

### B10a. Linear and Rollbar

- [10-5. Linear and Rollbar list rows spend their width on everything except the title](./b10a-linear-and-rollbar/10-5-list-rows.md)
- [10-6. Three status vocabularies, and dashboards print raw ids](./b10a-linear-and-rollbar/10-6-status-vocabularies.md)
- [10-9. The Linear and Rollbar detail headers: an 18-pixel title and three button looks](./b10a-linear-and-rollbar/10-9-detail-header.md)
- [10-10. The sub-issue bar is full as soon as one sub-issue is done](./b10a-linear-and-rollbar/10-10-sub-issue-bar.md)
- [10-11. Linear shows the last issue while the next one loads](./b10a-linear-and-rollbar/10-11-linear-keeps-last-issue.md)
- [10-12. Linear and Rollbar states: false claims, corner text, and raw codes](./b10a-linear-and-rollbar/10-12-states.md)
- [10-13. A Rollbar item hides the error two clicks away](./b10a-linear-and-rollbar/10-13-rollbar-shows-its-error.md)
- [10-19. Linear task panes list bare ids, and the menu offers Create task twice](./b10a-linear-and-rollbar/10-19-task-panes.md)
- [10-20. Smaller Linear and Rollbar defects](./b10a-linear-and-rollbar/10-20-smaller-defects.md)

Rail items are built on the node side. Rebuild the linear and rollbar bundles and restart the node.

### B10b. Dashboards and Home

- [02-7. Home has no empty state](./b10b-dashboards/02-7-home-empty-state.md)
- [02-8. The Add panel dialog shows a raw workspace id and a preview that does not match the panel](./b10b-dashboards/02-8-add-panel-dialog.md)
- [10-1. Dashboard rows look like buttons and do nothing](./b10b-dashboards/10-1-dashboard-rows-do-something.md)
- [10-4. The first panel on an empty Home draws on 44-pixel cells](./b10b-dashboards/10-4-first-panel-cells.md)
- [10-14. The dashboard panel frame: three left edges, and a menu trigger that vanishes](./b10b-dashboards/10-14-panel-frame.md)
- [10-15. Stat and chart typography](./b10b-dashboards/10-15-stat-and-chart-type.md)
- [10-16. Home's grid and header](./b10b-dashboards/10-16-home-grid-and-header.md)
- [10-17. Move and resize mode is hard to see and to learn](./b10b-dashboards/10-17-move-and-resize.md)
- [10-18. The panel editor, beyond 02-8](./b10b-dashboards/10-18-panel-editor.md)

`PanelGrid` is shared by three hosts. Home-only changes go through a prop. Delete any panels and tabs
you make, through the app, when done.

### B11. Tool panes

- [11-1. Three panes cut off whatever does not fit, and nothing scrolls](./b11-tool-panes/11-1-panes-that-clip.md)
- [11-4. Deleting a saved request or variable says it failed, and the row stays](./b11-tool-panes/11-4-bodiless-delete-responses.md)
- [11-5. The Database pane is three bars with a header nested in one](./b11-tool-panes/11-5-one-database-bar.md)
- [11-6. The Database frame has no inset, and its list has no header](./b11-tool-panes/11-6-database-frame.md)
- [11-8. The API detail: md controls in a bar, and the name in an 11-pixel button](./b11-tool-panes/11-8-api-detail.md)
- [11-9. Buttons in the tool panes come in four heights](./b11-tool-panes/11-9-button-heights.md)
- [11-11. Docker's detail: a level-3 title, long row meta, and a prune button in the wrong place](./b11-tool-panes/11-11-docker-detail.md)
- [11-12. The API response: an invisible copy button, and a timeline in tiles with machine labels](./b11-tool-panes/11-12-api-response.md)
- [11-13. Two save dialogs, two ways to label a field](./b11-tool-panes/11-13-save-dialogs.md)
- [11-14. The Database row editor uppercases column names and keeps a stale selection](./b11-tool-panes/11-14-row-editor.md)
- [11-15. The terminal drawer names every shell after the task](./b11-tool-panes/11-15-terminal-drawer.md)
- [11-16. Preview: an empty state that points the wrong way, and three names](./b11-tool-panes/11-16-preview-copy.md)
- [11-17. The usage popover and the session cost badge](./b11-tool-panes/11-17-usage-and-cost.md)
- [11-18. Smaller tool-pane defects](./b11-tool-panes/11-18-smaller-defects.md)

Rebuild the database, http, and agent-cost bundles. Restart the node for the node-core and `send.ts`
changes. Docker is read only.

### F. Final sweep

F closes no finding. It checks everything above:

1. **Visual sweep.** Take one screenshot per area and compare it with the same screen before the pass:
   Home, a task, Harnesses and defaults, onboarding's add step, the top bar, the palette typed into,
   Appearance, a project's setup tab, Tools and permissions, the workflow editor on a command step, the
   run pane at a gate, Changes, Context, a pull request with the seed, a Linear issue with the seed, Home
   with panels, a Database table, an API response, and Docker containers. Check one screen in Modern and
   one in Cozy for spacing that should move with the pack. Fix a one-line regression; list anything
   bigger for the user.
2. **Checks.** `pnpm lint`, then `pnpm test` (the whole suite, with its bounded concurrency), then
   `pnpm --filter @acorn/desktop test`. Re-run any red file alone before blaming a change.
3. **Docs.** Update the owning docs for what changed. `docs/ui-design.md`: tooltips, the 80 by 24 table
   for every new prop, chrome and overlays, states, shell hierarchy, menus, the page-title pattern, and
   the heading-level rule (K-batches wrote most of these; check each). `docs/ui-design/closed-kit.md`:
   the `description` against `help` rule, controls that do not stretch, sm buttons in chrome.
   `docs/frontend.md` § Pages and the save model and § Forms and flows: the help rule and both form
   shapes. `docs/tui.md`: `help` prints as a grey line. The plugin authoring notes: an older host ignores
   `help`, tree text may hold numbers, `Picker removeLabel`, and confirm labels. Grep `docs/` for every
   removed or renamed label.
4. **Deferred list.** Add anything a batch could not finish to [deferred.md](./deferred.md), with the
   reason. When the programme closes, move what shipped into the owning docs and delete this folder, as
   the other finished programmes did.

## Rules for a fix batch

- **One agent per batch, alone.** No sub-agents.
- **Read first:** this README, [house-patterns.md](./house-patterns.md), and each finding file in the
  batch. Where a finding file and the code disagree, the code wins: if a fix turns out wrong against the
  code, do not force it; record what you found and move on.
- **Verify in the real window.** Run `pnpm dev:agent -- --session <name>` (add `--fixture
  tui-navigation` for the fixture the review used), and drive it with
  `pnpm dev:agent:ui -- --session <name> snapshot`, `click`, `fill`, `scroll`, and `screenshot`. Take a
  before shot of every screen in the batch before you change anything, and an after shot when done.
  Look at every shot. See [Local development](../../local-development.md#agent-driven-desktop-development).
  Stop any session you start.
- **Run the checks** before you hand back:
  1. `pnpm lint` (oxlint, the icon census, and `tsc --noEmit` everywhere, which checks the kit's
     closed-props test).
  2. `pnpm --filter @acorn/client-core test` (CSS hygiene, the kit support table, node tests, the jsdom
     host tests).
  3. The tests of every other package you touched. When you add or change a kit prop, also
     `pnpm --filter @acorn/tui test` and `pnpm --filter @acorn/arch-tests test`.
- **Known reds you did not cause:** `kit/tokens/support.test.ts` "gives every exported node a row"
  (`ModelPickerPopover`), three `docPaths` cases in a worktree, one `agentSend` PTY case, and a Changes
  suite git stall that clears when the file runs alone. Timeouts under load (`iconCensus`, `layoutIndex`,
  `panes.test.tsx`, `workerHost`) pass alone. Check any red; fix only yours.
- **CSS hygiene ratchets only go down.** No literal `border-radius`, `border: Npx`, `box-shadow`
  geometry, or `z-index`; no new literal `font-size`; no hex outside the token sheets; at most 147
  off-scale spacing pixels.
- **The kit is closed.** No kit node takes `class`, `className`, `style`, or `classList`. A page that
  wants a control to look different asks the kit for a prop. A pattern that repeats is fixed once, in
  the kit or the shared stylesheet. Plugins carry no CSS. A new prop needs its terminal rendering, one
  80-column sentence in `docs/ui-design.md` § Every node at 80 by 24, and a line in `props.test-d.ts`. A
  prop that reaches plugins changes the published surface; additive optional props do not bump
  `PLUGIN_API_MAJOR`.
- **Never narrow the style-token contract.** Adding a token is fine; removing one breaks older style
  packs.
- **Hands off virtual lists, diff rows, and the agent timeline.** Performance work owns them. Prefer
  CSS, token, attribute, and prop changes. Do not change row heights, `DIFF_LINE_HEIGHT`, the diff's
  measure scheduler or height estimates, or move a virtual `Grid` into another container. The agent
  transcript is out of scope.
- **Copy.** Load the `readable` skill before you write any text. The product is "acorn", lower case.
  When a label changes, change its settings search declaration and any test that asserts the old text.
- **Record what you did,** per finding: what changed, what you measured, and anything you skipped and
  why. Update this folder: mark the finding done in this README, and add anything left to
  [deferred.md](./deferred.md). Do not commit unless asked.

## Driver quirks

The agent driver runs the real window hidden. These traps cost earlier batches time:

- **Animations and transitions never advance.** Before each screenshot, run
  `document.getAnimations().forEach(a => a.finish())` through the session's WebDriver `execute`
  endpoint, or tips and active states look wrong.
- **Virtual lists render no rows,** because `requestAnimationFrame` never fires. Through `execute`, set
  `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16)` and the matching
  `cancelAnimationFrame`, then leave the surface and come back so it remounts.
- **A failed request can sit on "Loading…" forever.** Judge failure states from the code.
- **Measure with scripts through `execute`,** not by eye.
- **Never return a string from `execute` that is cut through an emoji.** Strip surrogates with
  `.replace(/[\uD800-\uDFFF]/g, '')`. A sliced emoji from a Docker row crashed the shell twice.
- **The synthetic `click` skips outside-press dismissal,** so two popovers open at once is a driver
  artefact. A synthetic `mouseover` leaves a tip up until you dispatch `mouseout`.
- **Some controls need a DOM `.click()`:** an armed `ConfirmButton` (the driver click did not confirm),
  a strip tab in the GitHub PR pane, and dashboard panel header buttons, which are `opacity: 0` until
  hover and missing from the snapshot.
- **There is no key-press verb.** Reach things by clicking.
- **Refs belong to one snapshot.** Take a new snapshot after every transition.
- **A screenshot can be stale.** If two differ in content but share an md5, reopen the surface and shoot
  again.
- **The window is about 1440 by 900.** Report a narrow-width problem as a finding rather than resizing.
- **To see a code change,** stop your session and relaunch it with `--reuse`, which restages the
  renderer. To keep it alive past one tool call, run it with `nohup … &` and wait for the
  `[agent-dev:<name>] ready` line in its log. Node-side code and loaded-plugin bundles do not hot-reload:
  rebuild the plugin and restart the node.
- **After a restart, the window can hold an old bundle** whose lazy chunks are gone, and a page draws
  "This view stopped working". Reload the window before the before shots.
- **After a restart, WebKit may treat the driver's focus as a pointer's** and draw no focus ring.
- **The window follows the system theme,** so shots can switch to dark mid-batch.
- **For a pure CSS check,** a static HTML page that links the repo stylesheets, opened with the
  Playwright browser tools, is faster than a restart.

## Seeds for populated views

The fixture has no real accounts. The review seeded three areas. The scripts lived in `/tmp` and may be
gone; this is what they did, so they can be rebuilt.

**GitHub (B09).** With the session stopped, write a connected GitHub `integrations` row (a fake token
sealed with the session's own `session.key`), a GitHub facet on the fixture project, one task with
`pullNumber: 42`, and a mirror of six open pull requests, #42 to #47: approved and changes-requested
reviews, comments, commits, three threads, six checks in five states, labels, a conflicting pull, a
blocked one, one with auto-merge on, a draft stacked on #42, and one with nothing in it. Write the mirror
through the plugin's own `mirrorPr` and `mirrorFiles`, with every `fetched_at` ten years ahead so the
node never asks GitHub. Relaunch with `--reuse`. Revert by deleting every row and blob the script wrote.
The **Closed** tab asks GitHub live and stays on "Loading…" with a fake token.

**Linear and Rollbar (B10a).** Back up `core.sqlite`, then write a connected Linear and a connected
Rollbar `integrations` row (fake keys sealed with `session.key`), a `workspace_external_projects` link
for each to the Default workspace, and two tasks with linked items (one Linear link; two Linear and two
Rollbar links). Task ids must be UUIDs, or every tasks preview fails. Serve the data from the renderer:
the transport reads `window.acorn.nodeFetch` on every request, so wrap it to answer the
`/v1/p/linear/*` and `/v1/p/rollbar/*` routes with fake data, a chosen delay, or a chosen error code.
The tree panes use the same transport. Dashboards hydrate from a persisted cache at boot, so delete
panels and tabs through the app before restoring the database, or the next boot brings them back.

**Database and API (B11).** Wrap `window.acorn.nodeFetch` in the renderer to answer the database
connect, tables, columns, rows, and query routes with made-up rows (a `shop_dev` database with `users`,
`orders`, and five more tables). Saved queries and model backends go to the real node. A reload removes
the patch. For the API pane, run a small local HTTP server on `127.0.0.1` and point requests at it; a
closed port gives the network error. Delete any saved query, request, or variable you create.

## Hazards in the running app

- **Memory writes the user's real files.** The memory plugin resolves its folders from the user's home
  folder (`plugins/memory/src/server/knowledgeChannel.ts`), not the session's data root, so the agent
  session's isolation does not cover it. Never add, edit, or delete a memory, or approve a memory
  suggestion, through the app.
- **Docker is the user's real Docker** (OrbStack). Read only. Never press Start, Stop, Restart, Remove,
  Clean up, or Prune, and never open a container's **Terminal** tab, which runs `docker exec` in a real
  container.
- **Do not press Send in AI authoring,** or Generate in Generate SQL. Both call a model.
- **Do not press Send notes to agent, Publish, or Commit** in Changes.
- **A dismissed Publish review breaks a workflow after a node restart.** Escape or **Cancel** on
  **Publish workflow** leaves a prepared publication. After the node restarts, loading the workflow
  throws "requires reconciliation", the editor shows an internal error, and **Run…** fails. Discard the
  publication through the app's own route, `/defs/publications/:id/discard`, through
  `window.acorn.nodeFetch`.
- **Run… starts a workflow at once** when it needs no inputs, with no start dialog. Cancel any run you
  start.
- **Another worktree may run its own acorn window.** Never stop, signal, or reuse a process that is not
  your session.
- **The dev session has no `GITHUB_CLIENT_ID`,** so GitHub is missing from Add connection after a
  restart. A stored connection keeps working. Set the variable before starting the session to see the
  connect flow.
- **State the review left in the fixture:** the published workflow **Release check**, with a failed and a
  cancelled run on **Plan follow-up work**; a task note "Review checklist"; and a terminal session in
  **Review changed files**. Leave them, or restore them if you change them.
