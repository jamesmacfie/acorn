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
  07-5.
- **07-21c (part).** An If step gets two fixed branch rows (**If** and **Otherwise**), each a step
  picker, in place of the decide step's verdict editor. New feature. The condition editor's "name the If
  and Otherwise destinations below" line waits for it.
- **08-14 (part).** The diff's file filter also narrows the Changes file list. New feature. The empty
  state shipped in B08a.
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
  (06-1).
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
  items.". B10a found the em dash already gone and only moved the banner into the inset.
- **07-10 (part) and the 07 step blurbs.** Validator messages and step-type descriptions are read by
  the authoring model, a matcher, and tests (`generate/kinds.ts:97`, `ground.ts:6`,
  `generationRequest.ts:78, 114`). Rewriting them for people needs structured problems and a
  person-facing description field. Holds area 07's copy rows 864-893 (step blurbs) and 979-986
  (validator messages). When it lands, the gate step's blurb stays inline as one line (the plan's
  note on row 879), and the command timeout keeps milliseconds and says so (row 889).
- **07-13 (part).** Elapsed time from a step's first event. Needs a `startedAt` on the step row.
- **08-1 (part).** A `DiffSource.toolbar` member, so **Send notes** sits in the diff toolbar beside
  the notes. Plugin API. The `Alert` banner fallback shipped in B08a.
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
  CodeMirror. Needs a positioning rule or a `Rectangle` prop. 08-19's "No file open" copy waits with
  it: title "No file open", body "Pick one from the list, or use **Go to file**", or the bound chord
  through `formatChord`.

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
  (06-18).
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

- **`GenerateModal.tsx` skipped,** because B07b deleted it (07-18).
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
- **Sentry's connection provider label** stayed "Sentry (telemetry export)". B06 renamed it to
  "Sentry export" (06-18 item i).
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

### B06

- **06-17, skipped: the icon picker on the custom agent form.** `IconPicker` is not on the plugin UI
  surface, and the closed-kit tests hold the plugin barrel, the support matrix, the remote-tree node
  set, and the terminal's table to one list. Exposing it is a new kit node in about a dozen places,
  including the published SDK, which plan decision 20 rules out. The field stays a typed Lucide name
  with a shorter hint. Do it with a kit change that also gives the terminal a text form.
- **06-1, model-facing first sentences that stay:** `plugin_authoring` ("THIS node"), `agent_spawn`
  (`prompt`), `browser_navigate` (`run_status`), `browser_snapshot`, `browser_click`, `browser_fill`
  ("snapshot ref"), `memory_write` ("PROPOSE"), and `run_status` (a type). The real fix is the
  deferred person-facing `summary` on the tool.
- **06-3 changed from the plan.** AI models' Agent CLIs read the core model backends route, and
  Harnesses reads the agents plugin's provider descriptors, so the two cannot share one descriptor
  without a new seam. Both now say **Installed** or **Not installed** as a badge. Plugin rows map the
  status sentence to one badge word in `installed.ts` (`statusWord`) and keep the sentence in the
  description only when the word leaves something out.
- **06-5 changed from the plan.** Install a plugin keeps its setting rows, because **Install on** needs
  a help mark beside a select. Its buttons sit 8 below the package field, the same as the gap between
  that row's two controls. Add connection and Replace key share `CredentialFields`.
- **06-6:** the Overview tab opens with a **Status** section holding **Enabled** and the status alert,
  so the help-mark rule (decision 11) still has a section title.
- **06-8:** an MCP config server's command is cut to its last two folders per path, with the full
  command and its environment behind the row's help mark.
- **06-12:** the connection map's row label "Followed projects" became **Projects**, because a setting
  row needs a label.
- **Not checked live:** a connection's own page, Replace key, the device-code panel, a failed rail
  surface, a replacement offer, acorn.json plugin offers, a populated MCP servers list, and the API
  pane's Variables view in a task. The fixture has none of them. Each was read from code, and the
  connection page has a jsdom test.

### B07a

- **Shared with another session.** A second session added step and workflow timeouts in the same
  files while B07a ran (`TimeBudgetField.tsx`). Its labels, **Workflow timeout in minutes** and **Step
  timeout in minutes**, replace 07-15's "Time limit in minutes" in the Definition inspector. The
  schedule dialog says "Time limit in minutes". Pick one name in B07b.
- **07-2 and 07-6, changed from the plan.** A heading in a bar grows to fill it (the kit's rule), so the
  badges after the title sit beside the controls, in the editor header and the step header alike. The
  inspector's bars are direct children of the detail column, so they span it while the form stops at
  720. A new shared rule seats a bar that heads a scrolling detail column on its top edge. The run
  pane's step detail still wraps its bar in a `Stack`, so it keeps the 10-pixel gap above. B07b can
  move it the same way.
- **07-6, Result schema's explanation stays inline.** `Fold` has no `help`, so the rewritten line sits
  inside the fold.
- **07-8 and 07-9, the outline's "After" line is gone.** A row is two lines, so what a step waits on
  lives in the inspector's **Waits on**. The outline summary keeps **Run {workflow}** for a Run a
  workflow step, as well as the three the plan named.
- **07-9, joins indent.** A step that waits on more than one indents one past its deepest parent, as
  the plan says, so two branches that meet indent once more. Revisit if that reads as a staircase.
- **07-10, the footer keeps "and {n} more".** The fix said "· {n} more", and the copy table said keep.
  The copy table won.
- **07-15, the start dialog's limits sentence is gone,** and with it the dialog's fetch of the saved
  definition, which nothing else read.
- **07-16:** the disabled overflow items say "(publish first)" in their labels, because a disabled item
  takes no hover. A plugin kind with no icon draws `puzzle`.
- **07-17:** the add buttons in the inspector draw `Icon name="plus"`, and the gate field's **Reset** in
  the run pane is ghost. The Workflows list's **+ New** reads **New** with the plus icon.
- **Not checked live:** a workflow with branches, the graph's edge control (it needs two cards),
  **Not saved** with the node unreachable, the Publish badge after publishing, and the start and
  schedule dialogs. The session had no workflows, so one throwaway was made and deleted. Each was
  read from code, and the inspector, editor, and graph order have tests.

### B07b

- **07-1, the outline tip was already fixed.** B07a's outline row names a step's parents by name.
- **07-3, one status map.** `statusLabel` in `runs/runDisplay.ts` covers step, run, merged-list, and
  child-dispatch statuses, and the record history reads it too. Settings › Run history and Agent
  Center still print their own words.
- **07-3, kind names come from the catalog.** The run pane model reads the node's step catalog once, so
  `terminal:command` reads **Run a command**.
- **07-11, changed from the plan.** `openWorkflowRun` opens the pane with a `workflows:show-run` intent,
  as the agents center does, rather than a `?pane=workflows&item=` address. **Run…** in the editor passes
  `onStarted`, and the start dialog opens the run when nothing is passed. The pane model also had a
  race: an intent named a run before the pane listed it, and the newest-run fallback took the selection
  back. It now re-reads the list and holds the fallback while the read is out.
- **07-12, problem rows open the editor.** The editor shows the parse error, but it also draws an empty
  "Untitled workflow" with **Run…** enabled. That is the editor's handling of a broken file, not this
  finding, and is left as found.
- **07-12, tips on every run row.** Rows carry the task name and the error as a `tip`. No flashing was
  seen in the window with three rows; judge it again with a long list.
- **07-13, the footer.** A list footer that holds only a bar had a 14-pixel pad and a rule under it.
  `shell.css` seats such a bar on the column's bottom edge.
- **07-13, the step bar stays in its `Stack`.** It already draws flush with the column top in the window.
- **07-14, no page measure.** The run pane's detail region is drawn by the host and takes no
  `measure`, so the gate's input still spans the column. Capping it needs a pane-layout option.
- **07-14, a plain gate.** A gate with no form also moved its **Approve** and **Reject** under "Waiting
  for you.", so every gate answers under what it approves.
- **07-18, no kit change.** `Select` already grows a filter past eight options, so the timezone is a
  `Select` over `Intl.supportedValuesOf('timeZone')`.
- **07-18, AI authoring.** `AuthoringConversation`'s `bare` became `onClose`: with it, the view draws a
  modal body and footer with **Close** (or **Cancel** while a turn is out) and **Send**. A new
  `describePath` names a change's target, and the workflow editor passes step names. The badge beside
  **Send** that repeated the chosen backend is gone. The dashboards panel editor keeps the fold form.
  `generateReason` had no caller outside its test, so it went with `GenerateModal.tsx`.
- **07-20.** The schedule dialog's limit is **Workflow timeout in minutes**, the Definition inspector's
  name, and the summary reads "Up to {n} tasks, {n} at a time, {n} minutes."
- **07-21a, changed from the plan.** `uniqueStepName` names a new step in words ("Run a command 2") when
  the definition carries step ids, and keeps the slug for an older one. Its unused `STEP_NAME_RE` is
  gone.
- **07-21d, held.** Field hints feed the AI authoring prompt (`generate/kinds.ts`), so the env hint
  stays with the held step blurbs.
- **07-21g.** The record source reads `pluginLabel` and the source id. A source's own display name is
  not on the selection's provenance.
- **Not checked live:** a For each run's record history, child run cards and lineage, an agent step,
  the files export dialog, and an approved gate. The fixture has none of them. Each was read from code,
  and the relationships, record history, and node detail have tests.

### B08a

- **08-1, Send's label.** The banner says "{n} notes not sent", so its button reads **Send to agent**
  rather than repeating the count. Both fit on one line at the 300-pixel default. The banner draws the
  last result too, and a result with nothing left to send has a dismiss button. `agentIdle` and the
  model's `totals` had no reader once the header changed, so both went, with `model.ts § totals` and its
  test.
- **08-1, non-Git.** The header shows "Changes" with no count, and the list draws nothing; the detail
  owns the one "Not a Git project" state, so the fact is not said twice side by side.
- **08-11, measured.** The group box and the row box both sit at x 322 in the window, where they were
  322 and 292. In Notes, the scratchpad and a note both start at x 65. Notes' delete is a `RowActions`
  **Delete** that arms to **Delete note?**. Its tip no longer names the note.
- **08-13, the generate button.** It stays a `ConfirmButton`, so it keeps its **Replace?** arm, and
  takes `iconOnly` and ghost: 26 by 26. The kit already lets an armed icon-only button grow to its
  prompt, so the old "no `iconOnly`" note was stale. At 26 the footer needed 246 pixels in 244: an `sm`
  action row in a list footer took the pane-edge pad on top of the footer's own. `shell.css` drops that
  second pad, so the row starts on the message field's edge (62) and fits one line. Only Changes has an
  action row in a list footer.
- **08-13, the picker's tip.** `ModelPickerPopover` takes an optional `tipSub`, on both hosts; the
  terminal accepts and ignores it.
- **08-15, the clean check.** The model gains `loaded`, true after the first status read, so a loading
  task does not flash "No changes". `ChangesDiff` draws the centred "No changes" / "Everything is
  committed." itself rather than through `DiffPane`, whose fallback GitHub shares; that fallback is the
  centred "No changes", or a centred busy "Loading…".
- **08-15, Context's send copy.** "No running agent session." in Context stays for B08b's 08-8, which
  owns those rows.
- **08-17.** `fileStatusMeta` labels are sentence case ("Modified"). Nothing else read them. The
  collapse control keeps its text glyph in a 20 square. The header measured 36 high before and after.
- **08-18.** The **Ask agent** tip's second line shows only in unified view, because `lineAction` runs
  only there. `docs/diff-rendering.md` says what `lineAction.title` is for.
- **08-9, measured.** A note's badge starts at x 122 in unified and 78 in split, matching the code;
  before, 102 in both. Row positions in a scrolled diff matched the before shot.
- **Not checked live:** a clean tree, a folder that is not Git, a failed segment, a sent note, and
  Context loading. The fixture has none of them. Each was read from code, and the Changes list has a
  test for the empty tree and the notes banner.

### B08b

- **08-5, the fallback title.** The plan asked for "Agent turn {n}" or "Workflow step {name}". A finding
  carries a turn id and a step id, not a number or a name, so an empty body falls back to "Agent turn"
  or "Workflow step". Only the two fixed lifecycle titles are replaced; a producer's own title stays.
  A title drawn from the first sentence is left out of the excerpt under it.
- **08-5, the list never scrolled.** Findings drew plain rows in a column that hides overflow, so 13
  of the 19 fixture rows were out of reach before this batch too. The column takes `scroll`, and the
  rows sit in a `Stack`, because without the `Section` wrapper they shrank into each other. Measured:
  2,384 pixels of rows in an 825 column, each row 122 high.
- **08-7, the pin.** The Findings detail bar sat under the pane's pin. `task-view.css` reserves the
  pin's room for a remote tree's split inside a `single` pane, which no rule named. The button ends at
  1,334 where it reached 1,378.
- **08-7, Findings' second label.** The list header reads **Findings** with the count. The group label
  "Findings" shows only when **Ready in Memory** stands above it, so the column does not say the word
  twice. The detail's three part headings are `sub` headers on the column's edge (363, which is 14 in),
  and "Observation" reads **Details**.
- **08-7, measured.** Context's bar is 48 high with its title on 14, which closes K2's unmeasured
  `Toolbar` in the hbf header. The Notes title field is 26 high in a 48 bar, one line.
- **08-8, item rows.** `TreeRow` has a twist only when the item has a body or details. The terminal's
  `TreeRow` has no `label`, so the row's text is its name. The fold rule also covers the footer's
  **What the agent gets** fold: all three markers sit at 61 or 62, where they were 61 and 76.
  **Refresh** moved from the footer to the header bar. "Sent {ago}" reads "Sent just now" or "Sent 5m
  ago", and the queued toast lost its em dash.
- **08-12, the third group.** "Global" reads **Everywhere**, so the group label and the scope badge
  say one word. The header counts the rows shown, including the offered scratchpad.
- **08-19.** The terminal toggle is bare like the send button, so the strip has one look. The terminal
  prints it as "[ ] Edit in your terminal editor", and `panes.test.tsx` asserts that. A failed save
  reads "Couldn't save this file." Code is 12 with a 16.8 line, where it was 13 and 18.2.
- **08-20, the count.** The result count rides at the end of the toggles' strip, and the truncation
  note is a muted banner above the results. `sub` headers in a list column that does not scroll take
  the pane pad and a group label's rhythm, and a sticky one keeps the list's colour. The file name
  still sticks. The Search panel is the only `sticky` caller. Results were checked with made-up hits
  through `nodeFetch`, because the fixture's search returned nothing for any query.
- **08-21.** Type and Scope share a row through `Inline even`. **Cancel** clears the form and closes it.
  The labels live in `memoryClient.ts` as `MEMORY_TYPE_LABEL` and `MEMORY_SCOPE_LABEL`, which the
  review and the Memory page read too. The save path was checked by test only.
- **08-22.** Rows show the name, the description, and the path in mono, with type and scope badges as
  meta. Not seen populated: the session's memory list was empty, and the plan forbids adding one.
- **08-23, words.** A ready suggestion shows no status badge. History reads Edited, Dismissed,
  Restored, Snoozed, Separated, Approved, or Needed a fix, with the reason as words after a colon. The
  dismissal alert's body reads "Say why, if you like." over the reason buttons, because `Alert` needs a
  body. The diff is one hunk: shared lines at the start and end are context, everything between them
  changed (`memoryPatch`, with a test). The review was never seen in the app; it needs a review model.
- **08-24b, measured.** Group labels with an icon button are 34 high, where Notes' were 40. Changes'
  are 32: the last 2 pixels are the 20-pixel button over an 18-pixel line, and closing them needs a
  negative margin. The agent list's **Managed sessions** label took the same 34 and looks right.
- **08-24g, h.** The source key left the facts. "Observations" reads **Findings**.
- **The Memory page hung the window once.** The first visit in a fresh session timed out a screenshot
  and the window went down. The second visit, after a relaunch, was fine. Not traced.

### B09

- **Not seen in the window.** `pnpm dev:agent` would not start: the node build is 3,063,527 bytes
  against its 3,062,000-byte ceiling in `apps/node/scripts/check-service-budget.mjs`, on main as well
  as this branch, so the stage step fails before a window opens. Raising the ceiling was out of scope,
  so the batch has no before or after shots and no measurements. Every finding was checked by test
  and against the code. Take the screens in the final sweep, with the seed rebuilt.
- **09-1.** Both diff columns mount `DiffForPull` in a keyed `Show` over a memo of the route, and the
  pane's key includes whether the pull is read-only. `PullDetail.test.tsx` and a `PrPane.test.tsx`
  case fail against the old code. `DiffView.tsx` was unimported and is deleted.
- **09-2.** `checkStatusWord` and `checksSummary` live beside `checkStatusTone` and are exported on
  `@acorn/plugin-api/client`, because GitHub reads its helpers there. `startup_failure` joined the
  failed set, and `requested`, `waiting`, and `expected` joined the running set, so the dot and the
  word agree. `checksSummary` also says "{n} checks need action" for `action_required`, which the
  plan's list did not have. A review's verdict is the colour of its card's stripe (09-17c) and the
  byline verb is plain muted text; a separate state badge would repeat the verb.
- **09-3.** The table lives in `client/actionErrors.ts`, which the model and `DiffForPull` share. A
  message that is GitHub's own prose is kept. Unresolving a thread says "Couldn't unresolve the
  thread." About 20 other client files print a route's `error.message` as-is and have the same
  problem, mostly in agents, plus changes, docker, memory, and notes. Not fixed here.
- **09-4.** The blocked state keeps **Enable auto-merge (squash)** at outline, as the plan held it.
  With auto-merge on, **Turn off auto-merge** sits beside "Merges on its own when checks pass." In
  the terminal, **Merge** is the first stop in Details and the method `Select` the second, and four
  terminal tests changed to match.
- **09-7.** The row's styled tip is the full title with its age under it, rather than the full date,
  because the title is what the row truncates and a row with a tip drops its native `title`. The row
  tips on this virtual list were not judged for flashing. The header count shows on the Open tab
  only, because the Closed list arrives a page at a time.
- **09-8.** The no-project and no-remote states show in the detail only; the list region stays empty
  beside them. The loading mark (`Acorn`) stays for the first paint. The branch pickers say "Loading
  branches…" and "Couldn't load branches." through `emptyText`, the way the label and reviewer
  pickers already do, because `Picker status` draws above an empty list's own line and would say
  both.
- **09-9.** `Link` gained an optional `tip` on both hosts, with its 80 by 24 sentence. The terminal
  draws nothing for it. No `props.test-d.ts` line, because the prop is a plain string rather than a
  role token.
- **09-11.** `reviewDecision` lives in `pullDetail/model.ts` beside `reviewAction`, so it is tested as
  a pure function, and the model exposes it as a memo.
- **09-12.** The chord is the description field's string `hint` ("⌘↵ to create"), because `Field`
  takes no element there. **Cancel** returns to the pull list with nothing selected.
- **09-13.** The card and its title draw only when the importer draws its own close control. In the
  first-run wizard, which passes `showClose={false}`, the wizard is the frame. "Added as" comes from
  the projects query, matched on owner and name without case, so the per-visit marker is gone.
- **09-15.** The number leaves the title whenever the strip has more than one tab. The terminal does
  not draw the strip, so there a task with related pulls loses the number on its heading.
- **Pre-existing reds seen.** `client-core` `host/frames/scopes.test.ts` fails on
  `projectWorktreesRoute`, which main's "create a task on an existing git worktree" commit added
  without a frame scope. The terminal suite's 13 worker reds are the known Node 24.11 ones.

### B10a

- **Seen in the window.** The node build was 3,063,547 bytes against its 3,062,000-byte ceiling,
  so `pnpm dev:agent` would not start (the B09 wall). The user chose to raise the ceiling for real:
  `apps/node/scripts/check-service-budget.mjs` is 3,217,000, the measured figure plus about 5%. Every
  screen was shot before and after with a renderer-only seed (see the README's seeds).
- **10-5.** Rollbar's one field is the count, not `#id`: two 84-pixel tracks left Linear's title 31
  pixels, and the same would happen here. The `#id` is the collapsed row's `short` and heads the
  detail. Row tips were not seen to flash under a moving pointer, because the driver cannot move one.
  A row with a tip drops its native `title`, which had been its accessible name, so the row takes
  `label` as well.
- **10-6.** Canceled is neutral, because `Badge` has no muted tone. Rollbar's Active is neutral; the
  level badge carries the severity. Labels stay `Chip` with the team's colour, which the finding did
  not cover and the house rule ("Chip is never a label") still flags. The dashboards change applies
  to a mapped panel with one source only. With several sources and no columns, the board still builds
  its columns from what arrived, which an existing test pins. Not checked across a table, list,
  board, and chart in the window; checked by test.
- **10-10.** "1 of 2 done" sits above the bar, not beside it, because a `Meter` fills its line and a
  remote tree cannot size it.
- **10-12.** Load failures are a centred, titled `EmptyState` rather than a banner in the inset, the
  shape B09 gave GitHub's list. **Try again** is a child of the state, because a tree's props are JSON
  and `action` never arrives (11-7 is the same wall). "Nothing to show." is the host's fallback, not
  "Nothing here yet."; it kept its words. The loading count was the only 0 claim; a filtered list
  still counts its matches.
- **10-12 (part), still deferred.** **Reconnect** from a tree. The auth reasons say "Reconnect Linear
  in Settings." in words instead.
- **10-13.** Overview reads the newest occurrence through the cached `/occurrences/:id` route the
  Occurrences tab uses, not the compatibility composite. The heading is **Newest occurrence**, a label
  the plan did not give. The request URL spans its row (`wide`), which keeps it on one line at 1440;
  a URL longer than the row still breaks anywhere, since a URL has no word boundaries.
- **10-19.** Linear's rows show the title with the key as meta. In the 150-pixel task list the title
  still truncates; the tip holds it whole.
- **10-20.** "No description." and Rollbar's empty Overview line are muted text, not the small
  `EmptyState`: that one takes the row inset and sat 14 pixels in from the facts. "Resolved in" reads
  "Not resolved" rather than an em dash. The cycle reads "Ends Oct 7", or "Cycle 14" with no end date.
- **Not fixed, seen in passing.** In a task pane, a tree's first `Toolbar` does not reserve room for
  the pane's pin, so Rollbar's refresh icon and Linear's **Copy link** sit under it. This was true of
  the old **Refresh** button too. A list or detail `Section` header in a tree pane starts 14 pixels in
  from the content beside it ("Links", "Sub-issues", "Newest occurrence").
- **Census.** `tag` joined the eager icon set, and the census dropped `git-commit-horizontal`, which
  nothing names any more.
- **Pre-existing reds seen.** `client-core` `host/frames/scopes.test.ts`, as B09 recorded.

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
