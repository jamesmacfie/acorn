# UI consistency: the rest of the pass

**Status:** in progress. Nineteen of twenty-one batches shipped: eleven on branch `ui-inconsistency`,
and B06 to B10b on branch `more-ui`. B06 to B10b are merged to main. One area batch and the final sweep
remain.
Written 2026-10-01.
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

**B06, integrations and plugins.** Tools and permissions shows each tool's first sentence and puts the
rest behind help, and its tiers line up as md checkboxes. Lists of things on the integration and plugin
pages show status as a toned badge word. Price tables fit 720 with the id under the name, and **Reset**
shows only on a changed row. Add connection and Replace key share one page form. A plugin's page has
three tabs with the settings pages folded into Overview, and its versions are facts. The MCP pages link
to each other with ghost buttons, the acorn MCP server text moved to Tools and permissions, and config
servers are rows with an **On**, **Off**, or **Invalid** badge. The HTTP kinds read **Text**,
**Secret**, and **Command**. Services lost its AI models section, and the gallery titles itself for
the page that opened it. Rail and surfaces says only a row's exception. Copy across Sentry export,
Review after archive, custom agents, and Workflows was rewritten. See [deferred.md](./deferred.md)
§ B06 for what changed from the plan.

**B07a, the workflow editor.** The editor header is a 48 bar with a level 2 title, one save badge
(**Saved**, **Saving…**, **Not saved**), and **Published** with its version in a tip. **← Workflows** is
gone, and **Copy to database** reads **Make an editable copy**. The inspector opens with a header bar
that spans its column: the kind's icon, the step name with the kind's description behind its help
mark, the kind badge, and **Move up**, **Move down**, and **Delete**, which left the outline header.
Its form stops at 720, and its fields are md. Form sections are `sub` headings, and only optional
groups fold. The outline header reads **Steps** with **Add step**. Its menu groups kinds as Ask AI,
Records, Flow, and one group per plugin, with an icon on every item. A step row is two lines, and only
a fork indents, in the editor and the run pane alike. A required field stays quiet until it is
touched or **Publish…** or **Run…** is pressed, and the footer shows one problem and a count. Limits
share one set of names and minutes in the Definition inspector and the schedule dialog. The graph's
port and edge control are 20, the edge control draws `x` and names cards, and zoom stops at 0.6. A
bar that heads a scrolling detail column sits on its top edge. See [deferred.md](./deferred.md)
§ B07a.

**B07b, workflow runs, the rail, and dialogs.** The run pane names steps, reads statuses as words
(**Needs you**, **Stopped at a limit**) from one map, and names a contributed kind from the node's
catalog. A step's controls sit in its header bar, the error alert takes the step's status as its title,
and the footer is a status bar with a ghost **Cancel run** or a refresh icon. **List** and **Graph**
moved to the Runs header, and **Steps** is a group label. The gate form puts each field's description
and problem on the field, has md **Approve** and a confirming ghost **Reject**, and its clock keeps
counting while it waits. The inputs editor has a **Label** field. Opening a run from the rail, a
schedule, or **Run…** lands on that run in its task. The rail reads **Workflows** with help, problem
files are rows that open their editor, collapsed rows show initials, and run rows show a toned glyph,
a status word, and an age. Publish lists by name, schedule's timezone is a filtered select, AI
authoring has a footer with **Send**, and `GenerateModal.tsx` is gone. Record history folds its
provenance, and the bell drops "Workflow '…'". See [deferred.md](./deferred.md) § B07b.

**B08a, Changes and the diff.** The Changes list header is **Changes** with its count, then
**View options**, **Refresh**, and a ghost **Stage all**. Unsent review notes get a banner at the top of
the list, "{n} notes not sent", with **Send to agent**, and the send's result lands in it. A row's
stage box is its last control and lines up with its group's, and Notes' include box moved to the end
with delete in the row menu. The branch bar shows the branch alone, "Not published", and counts with a
tip in words. The commit footer fits one line. Clean and non-Git states are centred in the detail, and
a filter with no match draws a centred state with **Clear filter**. The composer has a ghost
**Cancel** first and a solid **Comment**, the note badge reads **Not sent** or **Sent**, and a note
starts at its code in both views. The file header's status is an xs badge with a styled tip, and code
lines carry no native tooltip. See [deferred.md](./deferred.md) § B08a.

**B08b, Notes, Context, Findings, Memory, and Editor.** Notes, Context, and Findings head their panes
with a 48 bar. Notes switches with a segmented **Edit** and **Preview**, its title is one line at 15,
**Show in Context** moved into the header, and the status strip is gone. Scope and author read as
`Badge` words (**Task**, **Workspace**, **Everywhere**, **By agent**, **From a workflow**) from one
map in `@acorn/protocol/notes.ts` that Context shares. Context folds start on the pane pad, the include
box sits before its section's label with a tip, every meter is 64 wide, items are tree rows with their
kind once as a badge, and the footer says **Send context** at sm. Findings titles come from the body's
first sentence, rows show a short time with the full date in a tip, the list scrolls, and the detail
headings sit on the column's edge. The Memory page is rows capped at 720 with its description in help.
The memory form is a stacked page form with one set of type and scope words, and its toast says
"Memory saved". The suggestion review has one solid **Approve**, words for every status and history
entry, a `StackedDiff` of the change, and alert buttons in `actions`. The editor's tab strip has two
icon buttons, its code is 12 like the diff's, and its search sits on the pane inset with paths in
their own case. Group labels with an icon button are 34 high. See [deferred.md](./deferred.md) § B08b.

**B09, GitHub.** Picking another pull request remounts its diff, so a reply can't land on the wrong
pull. Checks, states, and threads read as words (**Passed**, **2 checks running**, **Draft**,
**Resolved**) from `checkStatusWord` and `checksSummary`. A failed write says a sentence, with
**Reconnect GitHub** for a refused sign-in. The merge box is two left-aligned rows with one solid
primary, and a draft offers **Ready for review** instead of **Merge**. The facts are State, Author,
Branch, Review, Checks, and Updated. A pull row gives its title the room, with the number in front
and a short age. The list is **Pull requests** with **New**, the pane is **Pull request**, and the
sections are **Linked issues** and **Conversation**. The empty, loading, and failure states are
titled and say what failed. A thread links to "RailBadge.tsx, line 14" with the path in a tip
(`Link tip`). The new pull request form reads **From** then **Into** with a left-aligned footer. The
importer is a titled card of setting rows with **Link folder**. The check run dialog has **Open on
GitHub**. Not seen in the window: see [deferred.md](./deferred.md) § B09.

**B10a, Linear and Rollbar.** A rail row is the state or severity icon, the title, and one field: the
key for Linear, the occurrence count with a thousands separator for Rollbar. Row titles went from 59
to 123 pixels in the 300-pixel list. A row's title is its tip and its accessible name. The list shows
no count until it answers, and a filter that hides every row says "Nothing matches that filter." The
row menu offers **Open task** when an active task already tracks the row. The sources read **Linear
issues** and **Rollbar errors**, and Rollbar declares its own empty sentence. Picking another Linear
issue clears the one on screen, and a refresh keeps it with a banner above. Load failures are a
titled state with the reason in words and **Try again**, from a code table per plugin. The detail
headers are level 2 with a refresh icon button, and **Back to {identifier}**. Status is a toned badge:
Linear's from its state type and priority, Rollbar's from a word map. Activity and done marks are
icons, dates read "Oct 7", and the sub-issue bar is a ratio with "1 of 2 done" above it. Rollbar's
Overview shows the newest occurrence's message and stack, occurrence rows lead with the time and mark
the chosen one, "›" marks the line that threw, and mono is only for versions and hosts. A mapped
dashboard panel with one source keeps its field names and status words. See
[deferred.md](./deferred.md) § B10a.

**B10b, dashboards and Home.** Home has a centred empty state, "Nothing on Home yet", with one
**Add panel**, which moves into the title row once there are panels. The "Panels" label is gone from
Home, panels sit `--gap-stack` apart, tab names stop at 24 characters, and the strip no longer shifts
when a tab is picked. The first panel on an empty Home measures its cells. A panel is a `Card` at the
default pad with a level 3 title, the grip takes no room, and the menu trigger stays while its menu
is open. The menu reads **Move or resize** and **Remove from this dashboard**, and **Delete panel**
and **Delete dashboard** confirm. Pressing a row runs its action, and a write or execute action asks
first. A stat counts in the source's plural at the heading weight, chart ticks draw at 10 pixels at
any size, and an unsplit bar is the accent. Board columns stop at 320 pixels with the count beside
the label. Move mode draws the focus ring and says which keys to use. The editor is **Add panel** or
**Edit panel**, has no workspace id, says its save state in words, previews in a `Card`, shows board
controls only for a board, and publishes only once a query has a source. **Edit** previews on open,
mapping options read as labels, the per-query AI box starts closed, and the source picker names the
provider. See [deferred.md](./deferred.md) § B10b.

## What remains, in order

Run the batches in this order. Each depends on the kit batches. The GitHub
seed below is still the screen to check B09 against in the final sweep.

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

**Linear and Rollbar (B10a).** B10a seeded everything from the renderer, with no database writes.
Wrap `window.acorn.nodeFetch` to add a fake Linear and Rollbar connection to `/v1/core/integrations`,
a link for each to `/v1/core/workspaces/:id/external-projects`, and `links` on two fixture tasks in
`/v1/core/tasks`, and to answer the `/v1/p/linear/*` and `/v1/p/rollbar/*` routes with fake data, a
chosen delay, or a chosen error code. The tree panes use the same transport. The rail-items routes
answer rows the node builds, so the fake must mirror `shared/rail.ts`. The window is hidden, so focus
refetches never run: open **Settings**, **Services** to refetch the connections, and switch workspace
away and back to refetch the links. The script lived at `.acorn/agent-dev/b10a/seed.js`. Dashboards hydrate from a persisted cache at boot, so delete
panels and tabs through the app before restoring the database, or the next boot brings them back.

**Dashboards (B10b).** Publish panels through the app: **Add panel**, Workspace tasks, **Refresh
preview**, a view, **Publish**. Nothing in the app makes a second Home tab, so B10b added one to the
`tabs` list of the `dashboards` node preference with a `PUT /v1/core/prefs` through
`window.acorn.nodeFetch` (the body is `{ kind: 'bytes', bytes }` and the request needs a
`requestId`), then reloaded the window. Delete panels and tabs through their menus afterwards.

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
- **GitHub connects without `GITHUB_CLIENT_ID`.** The plugin ships acorn's public client ID, so
  fresh dev sessions show **Connect GitHub** in Add connection. Set the variable only to use your
  own app. An empty override hides the connect flow.
- **State the review left in the fixture:** the published workflow **Release check**, with a failed and a
  cancelled run on **Plan follow-up work**; a task note "Review checklist"; and a terminal session in
  **Review changed files**. Leave them, or restore them if you change them.
