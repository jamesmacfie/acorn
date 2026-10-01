# Deferred and unfinished work

**Status:** open. Written 2026-10-01. Line numbers are from 2026-10-01 and may have moved.

This file holds everything the UI consistency pass chose not to do, and why. It has three parts:

1. The plan's deferred list, grouped as the plan groups it. Twelve findings are deferred whole. The
   rest are the parts of a batched finding that were left out, marked "(part)".
2. Items the finished batches (K1a to B05) skipped or left partial, with their reasons.
3. Notes the finished batches left that are not findings but that a later session should know.

The decisions that need a person to choose are in
[Needs a product decision](#needs-a-product-decision). Each is reversible, and each blocks only its
own item.

## The plan's deferred list

### New features

- **10-2.** A second Home dashboard, and a way to place a removed panel again. The tab bar draws only
  when a workspace already has two named tabs, and nothing in the app creates the second one since the
  panel editor rewrite (`6734ce55`). **Remove from here** and **Delete dashboard** keep panel
  definitions in a "library" that nothing lists. New feature, and the "Add existing panel" library
  also needs a decision. Until then, the "library" sentence in the tab menu describes behaviour that
  does not exist; B10b skips its copy row.
- **03-22.** Right-click on session, pull request, changed-file, and source rows. New feature, and the
  listener must survive virtual row reuse.
- **07-5 (part).** Graph selection that edits, zoom controls and keys, edge labels, and the run graph's
  placement. New feature. The zoom-floor clamp and port sizes ship in
  [07-5](./b07a-workflow-editor/07-5-graph-small-part.md).
- **07-21c (part).** An If step gets two fixed branch rows (**If** and **Otherwise**), each a step
  picker, in place of the decide step's verdict editor. New feature. The condition editor's "name the If
  and Otherwise destinations below" line waits for it.
- **08-14 (part).** The diff's file filter also narrows the Changes file list. New feature. The empty
  state ships in [08-14](./b08a-changes-and-diff/08-14-file-filter-empty-state.md).
- **08-22 (part).** **Open** and **Delete** for a memory. Needs new memory routes, and opening a file
  outside the worktree.
- **08-24c (part).** The file in view marked in the Changes list while the diff scrolls. New feature
  on the diff's scroll tracking.
- **09-13 (part).** **Connect** opens Add connection with GitHub already chosen. The settings target
  grammar cannot say that; new host work.
- **11-16 (part).** An **Open Preview settings** action. No confirmed way for the plugin to open a
  project's Preview tab.
- **02-20 (part).** A **Manage workspaces…** row in the workspace picker. Needs a `Picker` footer row and
  an `openSettings` target, which is a protocol change. Area 02's copy row 530 waits with it.
- **03-19 (part).** The icon picker as a grid of icons. New layout. The words and name shipped in K4a.
- **03-8 (part).** Shortcuts drawn in palette rows and menu items. Needs keymap plumbing to fill a
  `shortcut` slot by command id. The one formatter, `formatChord`, shipped in B02.

### Wire-contract or plugin-API changes

- **06-7.** Plugin display names. **Shipped in K5** (lead's override 2), with the label parts of 03-24,
  04-5, 04-8, 04-14, 05-20, 06-1, 06-6, and 06-14. Listed here because the plan listed it.
- **06-1 (part).** A person-facing `title` and `summary` for each agent tool. New fields on the tool
  contribution and the catalog. B06 ships the first-sentence mitigation
  ([06-1](./b06-integrations/06-1-tool-descriptions-for-the-model.md)).
- **06-16.** An unsaved-changes guard for remote-tree settings pages, and a default project passed from
  the host. A new tree-to-host bridge call (`ctx.settings.unsaved(dirty)`). It also holds area 06's copy
  rows 779 to 781 for the API requests settings heading and its help.
- **11-7.** Header action slots for tree panes. `SectionHeader` and `Tabs` take element-valued
  `actions`, which a remote tree's JSON props cannot fill, so every tree pane adds a second bar. Needs a
  new tree node and a decision on whether it needs a `PLUGIN_API_MAJOR` bump.
- **10-3.** A rejected key reads as "no issues". The Linear rail route swallows failures and fanout
  cannot tell a failed route from a missing node; both shapes change. It also needs a decision on
  whether a source that needs re-auth stays in the rail. Area 10's host-list rows wait with it: "Stale"
  becoming a muted "Out of date" badge (with the stale-data phrase "Showing the last data we got." as its
  tip), "{node} unavailable — {reason}" naming the source, "no answer within 5s", and "No cached
  items.". B10a's [10-20](./b10a-linear-and-rollbar/10-20-smaller-defects.md) only drops the em dash.
- **07-10 (part) and the 07 step blurbs.** Validator messages and step-type descriptions are read by
  the authoring model, a matcher, and tests (`generate/kinds.ts:97`, `ground.ts:6`,
  `generationRequest.ts:78, 114`). Rewriting them for people needs structured problems and a
  person-facing description field. Holds area 07's copy rows 864-893 (step blurbs) and 979-986
  (validator messages). When it lands, the gate step's blurb stays inline as one line (the plan's
  note on row 879), and the command timeout keeps milliseconds and says so (row 889).
- **07-13 (part).** Elapsed time from a step's first event. Needs a `startedAt` on the step row.
- **08-1 (part).** A `DiffSource.toolbar` member, so **Send notes** sits in the diff toolbar beside
  the notes. Plugin API. The `Alert` banner fallback ships in
  [08-1](./b08a-changes-and-diff/08-1-changes-list-header.md).
- **08-16 (part).** Composer labels per diff source ("Note for the agent…", **Add note**, "Add a
  note"). A `DiffSource.compose` member.
- **08-8 (part).** **Add memory** in the Context section's actions. Changes the cross-plugin
  `context:section` slot contract.
- **09-8 (part).** A `reason` on `PullConflicts` (`no-checkout` or `fetch-failed`), and the checks route
  answering an empty list on failure. Server and wire changes. Holds the conflict alert's two sentences.
- **10-9 (part).** **Open in Linear** or **Open in Rollbar** that skips in-app link resolution (a new
  bridge option), and an eyebrow without the label treatment (a `Heading` change that restyles GitHub
  and Docker too).
- **10-12 (part).** **Reconnect** from inside a tree. The bridge has no verb that reaches settings.
- **10-19 (part).** Rollbar item titles in the task pane. Needs a batch title read.
- **11-6 (part).** A code for the Database "not configured" error, and an action that opens the
  project's Database settings. Holds area 11's copy row 544.
- **05-20 (part).** Names for revoked devices in the audit log. The server writes a name only for
  `device.paired`, so a name that ages out of the loaded rows is lost.
- **02-12 (part).** A loading shape for pane regions that wait. The performance work owns region
  loading.

### Structural merges

- **03-12.** Menu, Picker, and palette as one list vocabulary.
- **03-14.** The three workspace switchers as one. Also needs a decision on whether the current
  workspace is listed.
- **03-26.** New task and Promote to task as one form. New task moved onto `Modal` in K4b.
- **03-1 (part).** `PromoteToTaskModal.tsx`, `PluginTrustDialog.tsx`, and `PluginOverlay.tsx` onto
  `Modal`. Not mechanical: a tab strip between title and body, a boot-time dialog with no opener, and an
  iframe that swallows Escape. Their copy rows shipped in K4b. The `.plugin-trust-dialog`,
  `.plugin-trust-body`, and `.plugin-trust-identity` rules and the 520-pixel width are theirs.
- **03-25 (part).** The reference panel rebuilt on a `Drawer` with a side and a modal form. A new kit
  mode. The Escape and focus fix shipped in K4b.
- **06-8 (part).** One MCP page with an extension point: **Added by acorn** (the agents plugin's
  editable list) and **From your config files** (read-only).
- **05-10 (part).** Page rules onto `KeyValueEditor`. The editor lacks column headers apart from
  placeholders, a commit callback, and a wider row type. Holds area 05's copy rows 696 and 697 (the
  column headings **On**, **URL pattern**, **Field (CSS selector)**, **Value**).
- **06-9 (part).** HTTP variables and MCP env rows onto `KeyValueEditor`. Needs a password column and a
  change from per-row save to whole-list save.
- **09-9 (part).** One composer for comments and reviews. A different model from GitHub's, and a
  product call. Holds the one-placeholder and button-order copy rows.
- **07-18 (part).** Schedule's seven footer buttons, with **Run now**, **Pause**, and **Delete** moved
  elsewhere. Needs a decision on where they live.
- **03-24 (part).** The ⇧? binding moved from the GitHub plugin into core.

### Diff rows, virtual lists, and the agent timeline

The performance work owns these. Fix batches leave their structure alone.

- **08-10.** The diff gutter's Ask button covers the old line number on hover, and its glyph buttons are
  16-pixel text. They sit in fixed 20-pixel code rows, and `--control-h-xs` is taller in three packs. A
  CSS-only version exists in area 08's spot checks: widen the old gutter by two xs controls when a source
  offers gutter actions (`data-gutter-actions` on `.diff`), and draw `Icon`s with tips. Leave it for the
  performance rework.
- **09-5.** A header bar for each pull request column. A structural change inside `Sections`, the
  column scroll, and the terminal's tab names. Holds area 09's "Compare" header row.
- **09-15 (part).** The related-pull strip in the navigator's bar. Depends on 09-5.
- **09-9 (part).** A reply box that starts as one line, and **Resolve** and **Hide** at a real size.
  Both change measured diff thread heights and the estimates in `diffModel.ts`.
- **09-10 (part).** A markdown heading scale and task-list ticks. The kit's `Markdown` renders the agent
  transcript, and `SanitizedHtml` renders measured diff threads.
- **11-1 (part).** The Database row editor beside the virtual grid. `ListDetail` would put the grid in
  the narrow column; needs a layout decision.
- **11-18g (part).** Fixed 200-pixel `Grid` columns. The virtualiser needs fixed tracks.
- **11-5 (part).** A host header region for document layouts, so the Database bar sits above the SQL
  editor (and the pane's pin and close have a bar to sit in). Changes the layout contract.

### Kit modes the closed kit lacks

- **11-11 (part).** A padded detail column that does not scroll, for Docker's rail source. Needs a kit
  mode; `scrollDetail` breaks the log's own scroller.
- **08-15 (part).** The editor's empty state drawn over its `Rectangle`, which must stay mounted for
  CodeMirror. Needs a positioning rule or a `Rectangle` prop. The "No file open" copy in
  [08-19](./b08b-document-panes/08-19-editor.md) waits with it.

### Needs a product decision

These need someone to choose. Each blocks only its own item.

- **02-14. What collapsing the rail is for.** Hide the whole rail for room, or keep 48 pixels and hide
  only the tasks.
- **08-12 (part). Whether saving a note toasts.** The comment at `NotesPane.tsx:171` makes the toast
  deliberate. Area 08's copy row 694 waits with it.
- **09-4 (part). What a blocked pull request's primary is.** **Merge when ready** turns on auto-merge,
  which fails on repositories that do not allow it. Holds the "Merge when ready" and "Waiting for
  required reviews or checks." rows.
- **04-11 (part). Whether Extension points is hidden from production users.** Docs send users there
  (`docs/plugins/cooperative-extension-points.md`, around lines 448 and 484, and `docs/features.md`,
  around line 132), and the `replace` picker must move to Rail and surfaces first. B04 did the layout.
- **06-18a (part). Keep the Workflows settings page only for parse problems, or remove it.** It repeats
  the rail source and is empty with no task open. Its two copy rows can land either way
  ([06-18](./b06-integrations/06-18-smaller-defects.md)).
- **06-18h (part) and the vocabulary rule. One word for the computer.** Today the app says "This
  device", "this computer", "this machine", "this Mac", and "this node". The interim rule: say "this
  computer" in static copy about the machine the window runs on, keep **This device** for
  device-scoped chips, and name the node by its label where the code knows the active node is another
  machine. B05 wrote "on this node" where a schedule runs on the node the header names. A short
  vocabulary list in `docs/conventions.md` would stop the drift once the call is made.
- **07-2 (part). What the workflow editor header drops at narrow widths.** It holds about nine
  controls.
- **07-15 (part). An app-wide convention for required fields,** and whether `Field` gets a `required`
  prop. Workflows hand-builds " *" in three dialogs and "Required." in step hints; both stay until this
  is decided.
- **07-14 (part). The Edited badge and Reset on a field's label line.** Needs a `Field` label
  accessory, which is a kit design call.
- **10-18 (part). Build stat trend controls, or drop the trend code.**
- **03-15 (part). Palette ranking.** Whether an exact command match outranks a settings hit, or settings
  rows are tagged instead; and a checked mark on the chosen setting, which needs a field both palette
  hosts read (`sessionRows.ts:69`'s copy row waits with it).
- **00-11 (part). Escape to close a tip, and a pointer that can rest on it.** Needs the keymap, so a
  tip in settings does not also swallow the Escape that closes settings.

## Skipped or partial in the finished batches

### K1a

K1a skipped nothing. It left the New task dialog's full-width **Create** for K4b, which rebuilt the
dialog on `Modal`.

### K1b

- **A `stickyHead` table does not scroll sideways.** A scroller of its own would pin the sticky head to
  itself, so the dashboards `TableView` and the workflows `NodeDetail` table keep the old behaviour. No
  call site sets both `stickyHead` and `minWidth` today.
- **The tab count's new look is unshot.** No fixture screen shows a tab count.
- **`Badge` has no `id`.** The setting row wraps its scope badge in `span.ui-setting-scope` to carry the
  id, because adding `id` to `Badge` would change the published plugin surface.

### K2

- **Tab centring.** A tab label shorter than the 88-pixel minimum still centres, so "General" on the
  project page lands at 268 against headings at 262. The plan said not to change centring in this pass.
  In list columns the minimum is gone, so labels there land on the edge.
- **Docker's four tabs still overflow a 300 column by about 30 pixels.** The fade shows it. Shorter
  labels or a wider column would fit them.
- **Unmeasured:** `Toolbar` inside the hbf header (no fixture pane had one until B08b's Context), the
  `DocumentTabs` inset (no document was open), and the region-closing bar (no editor was open).

### K3

- **Kept on native `title`, on purpose:** `TreeRow` (a tip with no delay would flash on every row of a
  file tree), a `DocumentTabs` tab without its own title, `Grid` cells, and the diff rows' hand-built
  titles (perf-sensitive code).
- **`frameTips.ts` does not close a tip whose element leaves the frame.** The host's `tips.tsx` does.
  It can follow later.
- **The focus-ring shot.** After a restart, WebKit treated the driver's focus as a pointer's and drew no
  ring, so the "focused help mark" screenshot shows a pressed mark instead. The ring was checked before
  the restart.

### K4a

- **11-3, no live check.** Starting a local HTTP server was refused by the permission system, so the
  number fix rests on tests. The loaded bundles were not rebuilt by hand; the host sanitiser covers
  bundles built before the fix. The plugin-side template strings in `ResponseView.tsx` are picked up in
  [11-12](./b11-tool-panes/11-12-api-response.md).
- **The `Picker` list cap applies to every `Picker`,** not only the icon picker, because the closed kit
  has no per-call-site hook.

### K4b

- **`GenerateModal.tsx` skipped,** because B07b deletes it ([07-18](./b07b-workflow-runs/07-18-dialogs.md)).
- **The terminal host's own "Discard unsaved changes?"** (`apps/tui/src/chrome/Settings.tsx`) keeps its
  question mark. The desktop dialogs dropped theirs.
- **03-25, no live check.** A reference panel needs a pull request with a linked item.
- **The plugin approval dialog was not seen live.** The fixture cannot raise a request.
- **Held:** the GitHub shortcut's label ("Edit keyboard shortcuts"), which B02 then applied.

### K5

- **Client-only compiled plugins have no label.** `context` and `onboarding` have no node row, so where
  one prints its id, `pluginLabel` falls back to the id.
- **Kept on the id, on purpose:** the trust prompt, the approval dialog, the review, the two "waiting
  for your review" and "waiting for approval" bell rows, and the audit log. A loaded plugin chooses its
  own name, and only the id is unique on the node.
- **Sentry's connection provider label** stayed "Sentry (telemetry export)". It is
  [06-18](./b06-integrations/06-18-smaller-defects.md) item i.
- **Search by id** went missing when search indexed names only. B04 fixed it with `keywords`.

### B01

- **01-15 lands on the workspace's empty Home.** Finishing onboarding navigates to the first project,
  but the selected source stays Home. Choosing a source for the reader is the shell's restore logic.
- **01-16's description text sits about 4 pixels above the key cap's centre.** The description list
  aligns rows to the top; that is the kit's alignment.

### B02

- **02-3, skipped: the Active node `Select` at sm.** `Select` has no `size` prop, and adding one is a
  kit change. It only draws with two nodes or in a dev build.
- **02-1, not changed: `toggleFocusedPaneMax`** in `tasks.ts` still checks the stored layout, so
  maximizing a fallback pane by key does nothing until the person has acted on the layout once.
- **02-4: the Database pane's pin and close** sit over the first lines of SQL, because the pane has no
  top bar. That is 11-5's deferred header region.
- **Left open:** `FleetHome.tsx` (around line 69) and `AgentCenter.tsx` (around line 244) still say
  "{label} unavailable — {reason}". The palette's **Terminal › New terminal** hint still says "open a
  shell in the task worktree"; it was not in the copy table.

### B04

- **04-5, not done: dropping a shortcut row's prefix that repeats its section** ("Database: open pane"
  under **Database**). The label comes from the plugin, and stripping it on one page is a string match.
- **04-11:** layout only. Hiding the page waits for the product call above.
- **04-17 c and f, and 04-18:** notes with no change, and a dev-only page checked by `tsc` only.
- **Docker's project tab still shows its TOML example** with a copy button (now drawn as an icon).

### B05

- **05-21f, skipped: opening a run's task from Settings › Run history.** A settings page has no member
  on `SettingsPageContext` to close settings and select a task, and adding one changes the published
  plugin surface. A run from another node also needs its task looked up there. The section's help no
  longer promises it.
- **05-9 changed from the plan.** Each paired node stays a stacked row with its chips under the
  address, because `SettingRow` has no slot beside its label and an inline row's control column cannot
  hold five buttons. A slot would be a new kit prop.
- **05-15 side effect.** A plain run targets or page rules list no longer shows **Saved** after a
  write, because **Saved** lives on a `SettingRow`. A failed write still shows its error.
- **Not checked live:** the pairing fingerprint and code steps, an identity mismatch, an attached node,
  provided nodes, a stacked row showing **Saved**, the run targets table with a target, a page rule
  row, and the bulk bar. Each one writes, or the fixture cannot reach it.
- **Left alone:** the Docker project tab's copy (area 05's rows 718 and 719), which no batch owns. They
  are "acorn links a task to the Compose containers started in its worktree. These settings change which
  containers count." as help, and a **Where to change these** row naming the project's
  `.acorn/config.toml` without the absolute path. Apply them with any Docker settings work.

## Notes for later sessions

- **Uncommitted file moves.** B01 renamed `features/workspaces/onboarding.css` to `projects.css`, and B05
  deleted `NodeDevices.tsx`. Neither is staged; `git status` shows a deletion and an untracked file.
- **The Workflows pane can vanish from a task's switcher** after restarts (B02 saw it on **Plan
  follow-up work**). Its `when` asks whether the task has workflow runs. Not caused by this pass; worth a
  look in B07b.
- **Publish's Cancel** leaves a prepared publication (K4b). A clearer label, or discarding on cancel, may
  be wanted.
- **Settings' Escape.** In the driver, Escape in the node rename field also closed the whole settings
  dialog. The handler calls `preventDefault`, and the settings Escape listener does not check for it.
  This predates the pass.
