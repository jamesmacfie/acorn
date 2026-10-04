# Workstream 1: trustworthy results

Status: complete, 2026-10-03, in commit `49166f6b9` on the `dashboards` branch. Read
[design.md](./design.md) first. This workstream changes no contract except where a bug forces it, and
it builds nothing new. [Dashboards](../../dashboards.md) owns the shipped behaviour. The decisions
below record where the work departed from this plan.

## Outcome

Every requirement below landed except where a decision says otherwise. `pnpm lint` and the tests of
every touched package pass. A full `pnpm test` run fails in seven packages for reasons outside this
work: the loaded-plugin runtime refuses Node 24.11.0, and a few tests fail on additions from the
starting commit `0a9b222f`.

### Decisions

- **Old history is relabelled, not reset.** Requirement 10 says a changed signature resets the
  series. A series recorded under the previous signature formula is relabelled once on its next
  sample instead, so the upgrade doesn't wipe every panel's history. Real query changes after that
  reset as specified.
- **Focus refresh needed no code.** Requirement 11 asks for a refetch when the window regains focus.
  The client's default `refetchOnWindowFocus` with a 30-second `staleTime` already covers placed
  panels.
- **A plugin change refetches every placed panel on the Node.** The plugin-change event carries only
  the Node ID, not the plugin ID, so a panel can't match on the plugin it uses. Account changes do
  match per account.
- **View options on mapped panels still take source pointers.** Requirement 2 lets `display.groupBy`
  and `display.fields` take panel field IDs. The view's `field`, `x`, and `series` options still
  need source pointers, because the view schema is shared with plugin manifests. Publication refuses
  a mismatch, and workstream 2's column IDs remove the gap.
- **Old stored rows load leniently.** A stored panel that breaks the stricter field rule is read with
  its unresolvable references dropped, so the library list never fails to load.
- **The sessions budget is the host's record limit.** Requirement 7's host budget is the existing
  5,000-record limit. Past it, the source reports `incomplete` with the cause `host-budget`.
- **Editor edits moved into model functions.** The board and visible-field edits now live in
  `dashboardEditorModel.ts` as pure functions, which is what lets requirement 3's test build panels
  without rendering the editor.

### Manual check findings

The results are recorded in [testing](../../testing.md). Two items for later work:

- **Bug, not fixed:** with only the default Home tab, no tab bar or **+** button renders, so a
  person can't create a second dashboard from the UI.
- **Not checked:** the rail-source side panel and the `pane.aside` placement. No plugin in this build
  reserves either region, so check them once one does.

The visual checks only work with the `pnpm dev:agent` window in front, because a hidden window
paints nothing. The grid drag was driven with in-page pointer events, because WebDriver pointer
actions arrive as a single untrusted `mousedown`.

## Milestones

All of it lands in milestone 1, before anything else in that milestone, because the other workstreams
build on these paths.

## Goal

Every panel and every stored measure either tells the truth or says it can't. The other workstreams build
on these paths, so the bugs go first.

## What the owner gets at the end

- The editor no longer produces drafts that fail their own schema and silently stop saving.
- **Publish** refuses a panel whose fields, grouping, or view don't fit its sources, and says which
  part is wrong.
- The agent sessions source returns every session, or says it couldn't.
- Stat history never records a number taken from partial data, and editing a panel's query starts a
  fresh history.
- Placed panels refresh when an account or plugin they use changes.
- Due dates and other future times read "in 3h" instead of "now", and averages no longer print
  3.3333333.
- A recorded manual check of the dashboard surfaces that shipped before workflow v2.

## Starting point

- `packages/client-core/src/features/dashboards/DashboardEditor.tsx` writes `groupBy: 'status'` in
  `addColumnsFromStates` and `suggestCategories`. The schema in
  `packages/protocol/src/dashboards/panels.ts` requires `display.groupBy` and every entry of
  `display.fields` to be a JSON Pointer or empty. `status` is a panel field ID from
  `packages/dashboards-core/src/mapping.ts`, so the draft fails `dashboardPanelContentSchema`, the
  autosave never fires, and **Publish** reports "Choose what to show before you publish." The visible
  field checkboxes write panel field IDs on combined panels too.
- `validateDashboardContent` in `packages/node-core/src/server/dashboards/publication.ts` only resolves
  each query.
- `plugins/agents/src/server/data/sessionSourceHandler.ts` asks the session store for 500 sessions.
  The store caps a page at 100 and returns `nextCursor`, which the handler ignores, so the source
  returns at most 100 sessions and reports `complete`.
- `packages/node-core/src/server/dashboards/sampler.ts` appends a sample from every read, whatever its
  completeness.
- `measureSignature` in `packages/dashboards-core/src/signature.ts` hashes the query instance IDs,
  mapping, panel filters, aggregate, and field. It leaves out each query's predicate, account, and
  parameters, so a changed saved query keeps a series that now means something else.
- `PublishedDashboardPanel.tsx` caches under `publishedDashboardPanelKey`. Account and plugin change
  watchers call `invalidateDataSources` in `packages/client-core/src/features/dataSources/queries.ts`,
  which matches only data-source keys.
- `formatRelativeTime` in `packages/dashboards-core/src/relativeTime.ts` clamps elapsed time at zero,
  so any future instant reads "now".
- `formatCell` in `packages/dashboards-core/src/format.ts` prints numbers with `String(numeric)`.
- [Dashboards](../../dashboards.md) describes the preference envelope as version 1 and shows
  `"version": 2` in its example. The code writes 1.

## Requirements

### Field references

1. The editor never writes a panel field ID where the schema requires a source pointer.
2. Until workstream 2 replaces both with column IDs, `display.groupBy` and `display.fields` accept the
   reserved panel field IDs (`title`, `status`, `assignee`, `updated`, `url`, and `source`) when the
   panel has a mapping, and source pointers otherwise. The schema enforces that rule.
3. A test builds a board and a combined panel through the editor model functions and parses the
   result with `dashboardPanelContentSchema`.

### Publication checks

4. `validate` and `publish` describe each source, project the panel with no records, and check four
   things:
   - Every display field and the grouping resolve in the projected schema.
   - The view kind is one that `viewsForSchema` allows.
   - Every view option names a field of a suitable type.
   - Every mapped role points at a described field.
5. Each problem names its path, such as `/display/groupBy`, and says what is wrong in words a person
   can act on.
6. The authoring route's candidate validation calls the same check, so the AI can't propose a panel
   that publication would refuse.

### Completeness

7. The sessions source follows the store's cursor until the selection is exhausted or a host budget
   stops it, and reports `incomplete` with the right cause when it stops early.
8. The sampler skips a panel whose run includes any read that isn't `complete` or `bounded`. The run
   row names the reason.

### History identity

9. The measure signature includes, for each query, the resolved revision digest of a saved query or
   the digest of inline content, plus the resolved parameters and account.
10. A changed signature resets the series through the existing reset path, and the reset is counted in
    the sampler's run result.

### Refresh

11. Placed panels refetch when the Node announces a change to an account or plugin that one of their
    queries uses, and when the window regains focus.
12. The panel's periodic refresh moves to workstream 2, where the plan carries `refresh`.

### Display

13. Future instants read "in 5m", "in 3h", "in 2d", and "in 1mo". Past instants keep their current
    wording. The absolute time stays in the tooltip.
14. Numbers format with `Intl.NumberFormat` in the device locale, with digit grouping and at most two
    fraction digits unless the field's unit says otherwise. The `%` rule stays.
15. Both rules have tests in `format.test.ts` and `relativeTime.test.ts`.

### Docs

16. [Dashboards](../../dashboards.md) shows the envelope version the code writes.

## Verify what shipped

Several surfaces shipped before workflow v2 and were never checked in a running app. Check them once
in `pnpm dev:agent`, record the results in [testing](../../testing.md) under the dashboard checks, and
file anything broken against this workstream:

- The grid drag: the dot lattice, the soft slot, the lift, and neighbours moving out of the way.
- The tab bar: create, inline rename, arrow keys with Home and End, the armed delete, and the active
  tab surviving a reload.
- The chart legend wrapping in a one-cell panel, and the three series colours across the style packs
  in light and dark.
- The stat sparkline and its "collecting since" state. Until workstream 2 restores the view controls, set
  `trend` through the AI or by editing the draft.
- A rail-source side panel and a `pane.aside` placement at real widths, and whether twelve collapsed
  columns feel cramped there.

## Done when

The editor's board and combined-panel paths produce drafts that save and publish. Publication rejects
a panel with an unknown field and names its path. The sessions source returns more than 100 sessions
when more exist. A panel over an incomplete read records no sample. Changing a saved query's filter
resets its panel's history. Disconnecting an account refreshes a placed panel that uses it. Future
dates and averages read correctly. The manual check is recorded.

## Docs to update

- [Dashboards](../../dashboards.md): publication checks, the sampler's skip rule, the signature, and
  refresh behaviour.
- [Typed data sources](../../data-sources.md): no change unless the sessions fix changes its stated
  limits.
- [Testing](../../testing.md): the manual check results.

## Verify before building

- The two `groupBy` writes and the visible-field checkboxes in `DashboardEditor.tsx`.
- That `listSessions` in `plugins/agents/src/server/sessions/store.ts` still caps pages and returns
  `nextCursor`.
- Where the sampler resolves queries, so the signature can use the resolved digest without a second
  resolution.
- Which client events announce account and plugin changes, and that they carry the plugin or account
  ID a panel can match on.
