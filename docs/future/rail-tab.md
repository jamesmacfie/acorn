# Complete loaded task annotations and retire the rail plan

Status: **follow-up required 2026-09-12.** Planned against commit `50a0c0d7`.

The rail control and marker allocator shipped in August 2026. The separate loaded-plugin
`railMarkers` contribution did not ship and must not be revived. Loaded plugins publish task status
through the generic `annotation` extension kind and the core-owned `core:task` point instead.

That replacement is incomplete. Annotation results do not follow the chrome freshness lifecycle,
the retained response budget is not enforced, route-backed extensions can be declared without a node
bundle, and the terminal client drops markers that do not receive one of the desktop's four corners.
The owning documentation also describes two contradictory contracts.

Use this file as the implementation plan for closing those gaps. When every done criterion passes,
move the surviving contract into its owning documents and delete this file.

## Outcome

Completion means all of the following are true:

- A loaded plugin can contribute task annotations through one batched POST per contributor and visible
  task set.
- Annotation results refresh after that contributor's status event, plugin push, declared polling
  interval, reload, disable or enable, and active-node change.
- Results and in-flight work cannot cross node, contributor, descriptor, or visible-key boundaries.
- A failed or malformed contributor cannot blank another contributor's marks.
- Annotation requests and responses have explicit budgets. `core:task` retains the original
  256-mark-per-contributor response budget without truncating legitimate diff annotation batches.
- A manifest cannot declare an `items` or `route` extension unless its package has a node bundle that
  can serve the route.
- Desktop and terminal clients preserve every accepted task state in their host-appropriate
  presentation.
- Loaded task markers are documented in the plugin authoring and contract pages. Source and pane
  markers are explicitly out of scope until a real loaded plugin needs them.
- No live document or source comment points to this file.
- This file is deleted and its history is recorded in `docs/future/README.md`.

## What already shipped

Do not rebuild these parts:

- `packages/client-core/src/features/tabs/RailTab.tsx` is the host-owned control used by both desktop
  rails.
- `packages/client-core/src/features/tabs/railMarkers.ts` validates, orders, allocates, and legends
  semantic markers.
- `packages/client-core/src/host/registries/rail/railMarkerFeed.ts` owns the compiled
  `ctx.railMarkers.register` path.
- Core, agents, and Docker publish compiled markers through that registry.
- `packages/protocol/src/extensionPoints.ts` declares the generic annotation wire shape and the
  core-owned `core:task` point.
- `packages/client-core/src/host/annotations/taskAnnotations.ts` translates accepted `core:task`
  marks into ordinary `RailMarker` values.
- `packages/client-core/src/features/tabs/TabRail.tsx` and `apps/tui/src/chrome/Rail.tsx` request one
  annotation batch for the tasks in the visible workspace.
- Loaded manifest `extensions` entries already carry annotation requests through a plugin-owned
  `items` route. The host POSTs visible keys, sanitises each returned mark, and stamps contributor
  provenance.

The original three-slice plan remains in git history:

```sh
git log --follow -- docs/future/rail-tab.md
```

## Architectural decision

Keep one annotation mechanism for facts attached to host-drawn items. Do not add a second
`contributions.railMarkers` manifest key, a rail-specific query runtime, or plugin-rendered rail
markup.

The tier split is intentional:

- Compiled plugins may publish markers for task, source, or pane controls through
  `ctx.railMarkers` because their callbacks run inside the client and may read existing signals.
- Loaded plugins may publish task markers by contributing annotation data to `core:task`. Core owns
  the task row, batches the task keys, draws the marker, and decides its placement.
- Loaded source and pane markers remain out of scope. No core annotation point exists for either, and
  no production loaded plugin needs one. If the verification pass finds such a consumer, stop and
  design the point with that plugin instead of generalising from the task row.

This decision keeps plugin data on the node, prevents plugin code and CSS from entering shell chrome,
and gives desktop and terminal clients the same accepted facts to project.

## Current data flow

The implementation crosses these boundaries:

```text
loaded plugin manifest
  contributions.extensions[] { point: "core:task", items: "/v2/p/<plugin>/..." }
    -> protocol manifest schema
    -> node manifest ownership checks
    -> fleet plugin roster
    -> client chrome registration
    -> extensionRegistry entry with a node-bound marks() callback

desktop TabRail / terminal TaskList
  -> requestTaskAnnotations(visible task ids)
  -> requestAnnotations("core:task", keys)
  -> one POST to each eligible contributor
  -> readAnnotationMarks() sanitises each row
  -> annotation store stamps and indexes marks by the owner's declared key
  -> taskAnnotationMarkers(task id)
  -> compiled railMarkerRegistry adapter
  -> resolveRailMarkers()
  -> RailTab tooltip and accessible description, or terminal row markers
```

The defect sits between registration and the annotation store. Chrome status and plugin-push events
increment `chromeDeps(pluginId)`, but the annotation request path never reads that dependency.
`requestAnnotations` deduplicates only on the point and visible-key string. The point-level store also
omits the active node and contributor identity. `clearAnnotations` claims contribution sync calls it,
but the desktop has no such production call.

The result is stale state:

- A contributor can change its answer while the visible task ids stay unchanged, and the client does
  not ask again.
- Disabling, enabling, reloading, or removing a contributor can leave its previous marks in the
  store.
- Two nodes with the same task ids can display the first node's answer after a node switch.
- A late answer can overwrite state for a newer node or contributor set unless request identity and
  cancellation cover those dimensions.

## Invariants to preserve

The implementation must preserve these rules:

1. The draw site passes one visible key batch. It never starts a request per row or rail control.
2. Each eligible contributor receives at most one request for one unchanged combination of point,
   node, descriptor, freshness revision, and visible keys.
3. A plugin-specific freshness event refetches only that plugin's annotation contributions. A global
   status event may refetch every loaded contributor.
4. A changed node, contributor set, or descriptor clears the affected stale marks before its new
   answer becomes visible.
5. A superseded request is aborted. Its answer is ignored even if the contributor ignores the abort
   signal.
6. A failed contributor produces no marks for that contributor and records its own surface failure.
   Other contributors keep their results.
7. The host stamps the contributor id. A response cannot claim another plugin's provenance.
8. The owner declares the key fields and their order. Extra response fields cannot widen a match.
9. Annotation data contains scalar keys, one of the declared severities, bounded display text, and an
   optional host-resolved icon. It contains no markup, CSS, geometry, or per-mark verb.
10. `core:task` annotations become ordinary rail markers. They use the four public corners and cannot
    outrank host lifecycle markers or use `bottom-center`.
11. Marker allocation remains deterministic. Every marker accepted within the task point's budget is
    represented in the desktop legend even if it receives no corner.
12. The terminal has no corner geometry. It must project every accepted marker in allocator order
    instead of discarding entries that did not receive one of the desktop's corners.

## Budgets

Do not apply the rail's original 256-item limit to every annotation point. A diff may ask about 2,000
visible line keys in one request, and a legitimate contributor may answer many of them.

Implement two levels of protection:

- Add a shared generic hard ceiling for raw annotation response rows. Set it high enough for the
  existing 2,000-key diff contract and document the chosen number beside the constant. Stop scanning
  after the ceiling so malformed rows cannot create unbounded validation work.
- Add a point-owned accepted-mark limit. Set `core:task` to 256 accepted marks per contributor and
  request. Apply that limit after malformed rows are isolated, before marks enter reactive state.

Use a field on the registered annotation point or an annotation request policy. Do not infer the
tighter budget from the point id inside `chromeData.ts`; that module must remain generic. If the
existing `max` field is adopted as a per-key annotation limit, update its protocol type, parser
comments, authoring documentation, and tests together. Do not silently change the `stack` meaning
used by remote and rectangle points.

The count ceiling limits retained and processed rows after JSON parsing. Before claiming a wire-byte
bound, verify whether the desktop bridge already caps response bodies. If it does not, describe this
honestly as an item-count bound and open a separate transport-wide design only if other descriptor
reads have the same exposure.

## Scope

Files expected to change include:

- `packages/client-core/src/host/annotations/annotations.ts`
- `packages/client-core/src/host/annotations/annotations.test.ts`
- `packages/client-core/src/host/annotations/taskAnnotations.ts`
- `packages/client-core/src/host/annotations/taskAnnotations.test.ts`
- `packages/client-core/src/host/registries/extensionPoints/extensionPoints.ts`
- `packages/client-core/src/host/chrome/chromeData.ts`
- `packages/client-core/src/host/chrome/chromeData.test.ts`
- `packages/client-core/src/host/chrome/chromeExtensionPoints.ts`
- `packages/client-core/src/host/chrome/chromeExtensionPoints.test.ts`
- `packages/client-core/src/host/chrome/chromeRegister.ts`
- `packages/client-core/src/host/chrome/chromeRegister.test.ts`
- `packages/protocol/src/extensionPoints.ts`
- `packages/protocol/src/plugin/contract.ts`
- `packages/node-core/src/server/plugins/manifest.ts`
- `packages/node-core/src/server/plugins/manifest.test.ts`
- `apps/tui/src/chrome/Rail.tsx`
- the closest existing TUI chrome or rail test
- the owning documents listed in the final phase

Keep these out of scope:

- A `railMarkers` manifest contribution.
- Loaded source or pane marker points without a real consumer.
- Interactive markers or nested buttons.
- Plugin JSX, CSS, colour values, or placement coordinates in shell chrome.
- A request, timer, observer, or WebSocket subscription per visible task.
- Changes to compiled `ctx.railMarkers` callers unless a regression test exposes a defect.
- A general rewrite of query caching or chrome descriptor reads.

## Verify before building

Run these read-only checks before editing code:

```sh
git diff --stat 50a0c0d7..HEAD -- \
  packages/client-core/src/host/annotations \
  packages/client-core/src/host/chrome \
  packages/client-core/src/host/registries/extensionPoints \
  packages/protocol/src/extensionPoints.ts \
  packages/protocol/src/plugin/contract.ts \
  packages/node-core/src/server/plugins \
  apps/tui/src/chrome/Rail.tsx

rg -n "clearAnnotations|requestAnnotations|readAnnotationMarks|chromeDeps" \
  packages/client-core/src apps/tui/src

rg -n "core:task|future/rail-tab|rail-tab.md" \
  docs packages apps plugins

rg -n "markersFor\(\{ kind: '(source|pane)'" \
  packages/client-core/src apps plugins
```

Confirm these assumptions:

- `clearAnnotations` has no desktop lifecycle caller.
- `requestAnnotations` deduplicates before it reads the eligible contributor set or chrome revision.
- `readAnnotationMarks` has no response count limit.
- `syncChromeContributions` disposes and re-registers extensions without clearing their stored marks.
- No loaded production plugin needs a source or pane marker.
- `core:task` has no end-to-end loaded-plugin test.

Stop and revise this plan if any assumption is false. Preserve unrelated working-tree changes.

## Phase 1: Characterise the failures

Write failing tests before changing the lifecycle.

### Annotation state tests

Extend `packages/client-core/src/host/annotations/annotations.test.ts` to cover:

- The same visible keys do not issue a duplicate request at the same node and freshness revision.
- Incrementing one contributor's revision refetches only that contributor.
- Removing or disabling one contributor removes its marks without removing another contributor's
  marks.
- Re-enabling a contributor requests its marks even when the visible keys are unchanged.
- Re-registering the same descriptor id cannot reuse results from its previous registration.
- Switching from node A to node B with identical keys clears node A's marks and requests node B.
- A late node A answer cannot overwrite node B.
- A rejected contributor clears that contributor's previous answer and leaves the others visible.
- Reordering responses cannot reorder contributors or change provenance.

Use controllable promises and `AbortSignal` assertions. Keep the tests on the plain TypeScript module;
do not move lifecycle logic into a component to make the test possible.

### Loaded path test

Extend `packages/client-core/src/host/chrome/chromeExtensionPoints.test.ts` or the nearest integration
test to exercise the real path:

1. Seed a loaded roster entry whose manifest contributes `items` to `core:task`.
2. Register the chrome contribution.
3. Call `requestTaskAnnotations` with two task ids.
4. Assert one POST reaches the plugin-owned route with both keys.
5. Return one valid mark and one malformed mark.
6. Assert the valid mark reaches `markersFor({ kind: 'task', id })` with host-stamped provenance.
7. Trigger plugin freshness, disable, and node-switch cases and assert the stored marker follows each
   lifecycle transition.

Do not satisfy this test by injecting an in-process `marks` callback. The existing
`taskAnnotations.test.ts` already covers that narrower translation.

### Budget tests

Add tests around `readAnnotationMarks` and the annotation store:

- The generic raw-row ceiling stops validation work at its boundary.
- Malformed rows are dropped individually.
- Valid rows after an earlier malformed row still survive while they remain inside the raw budget.
- `core:task` retains no more than 256 accepted marks from one contributor and request.
- The 2,000-key diff request remains one request and is not truncated merely because it is not a rail
  point.
- Excess rows never enter the reactive store or tooltip legend.

### Manifest tests

Extend `packages/node-core/src/server/plugins/manifest.test.ts`:

- A manifest with an `extensions[].items` route and no `node` bundle is rejected.
- A manifest with an `extensions[].route` hook and no `node` bundle is rejected.
- The same descriptors pass when `node` is declared.
- `remote` and `frame` contributions keep their existing client-bundle validation.
- Descriptor-only harnesses remain valid; they do not serve a route.

### Terminal tests

Add a TUI rendering test with at least five markers competing for the same desktop corner. Assert that
the task row retains every accepted marker representation in stable order. The terminal may render
all legend glyphs because it has no two-dimensional placement constraint. If width forces a compact
count, test the count and the host-owned way a reader can inspect the omitted labels.

Phase 1 is complete when every new test fails for the expected reason and existing focused tests still
pass.

## Phase 2: Scope and refresh annotation state

Refactor annotation state by point and contributor. A point-wide combined promise is insufficient
because a plugin-specific status event must not refetch unrelated contributors.

Recommended state identity:

```ts
type AnnotationContributionState = {
  contributionId: string
  scope: string
  revision: number
  keySignature: string
  controller: AbortController | null
  marksByKey: Map<string, StampedMark[]>
}
```

The exact container may differ, but it must retain a separate request identity and result map per
contributor. Keep one reactive read per point so `annotationsFor(point, key)` does not create a signal
or fetch per row.

Implement the lifecycle in this order:

1. Extend loaded annotation contributions with host-owned accessors for request scope and freshness.
   The scope returns the active node id captured by the chrome binding. The revision reads
   `chromeDeps(pluginId)`. Compiled test contributions may omit both and receive stable local defaults.
2. In `requestAnnotations`, resolve eligible deliveries before deduplication. Read their ids, scopes,
   and revisions inside the caller's Solid effect so node and freshness changes schedule another pass.
3. Remove state and abort work for deliveries that are no longer eligible.
4. For each remaining contributor, compare the contributor id, scope, revision, and visible-key
   signature. Reuse only an exact match.
5. When any identity part changes, abort that contributor's request and clear its previous marks
   synchronously. Then start one replacement request with the full visible key batch.
6. Stamp returned marks with the contributor id and index them using the owner's declared key fields.
7. Publish a new point-level merged map in `extensionDeliveries` order whenever one contributor
   changes. Do not let response completion order determine marker order.
8. Guard every completion with the exact state object or generation that started it. Ignore a stale
   completion even when the contributor did not honour abort.
9. Make `clearAnnotations` notify existing readers before deleting state. Call it from chrome
   contribution disposal or sync so a reload of the same plugin and descriptor ids cannot reuse a
   previous answer.
10. Keep surface-failure reporting contributor-specific. Treat abort as cancellation, not failure.

Use the existing shared chrome watcher. Do not add an annotation timer or WebSocket subscription.
`watchChrome` already maps status, plugin push, and polling to `chromeDeps`; the annotation
contribution only needs to consume that dependency.

Phase 2 is complete when all annotation state and loaded-path tests pass, and one plugin's revision
does not issue a request to another plugin.

## Phase 3: Enforce annotation budgets

Define the generic raw-row ceiling in the shared protocol module beside `PluginAnnotationMarks`.
Expose only the constant needed by both runtimes. Keep `@acorn/protocol` free of client imports.

Carry the point-specific accepted-mark budget through the existing owner registration and request
path. The host that owns `core:task` sets 256. Apply budgets in this order:

1. Refuse a non-array response as an empty result.
2. Inspect no more than the generic raw-row ceiling.
3. Sanitize rows independently and record malformed rows through the existing drop path.
4. Retain no more than the point's accepted-mark limit for that contributor.
5. Stamp provenance and write only retained marks into annotation state.

Do not let an invalid row cancel the batch. Do not let discarded rows appear in the desktop legend or
terminal projection. Log one bounded summary for overflow rather than one warning per discarded row.

Phase 3 is complete when the limit tests pass and the existing 2,000-key annotation test still proves
one batched request.

## Phase 4: Require a node bundle for route-backed extensions

In `packages/node-core/src/server/plugins/manifest.ts`, apply the same node-bundle rule already used by
schedules, task checks, probes, and other route-backed contributions:

- If an extension declares `items`, require `manifest.node`.
- If an extension declares `route`, require `manifest.node`.
- Keep route namespace confinement unchanged.
- Do not require a node bundle for `remote` or `frame`; their client-bundle rules remain separate.
- Do not reject manifest-only harnesses or other descriptor-only contributions that call no plugin
  route.

Use one validation branch for both route carriers and produce an error that identifies the carrier and
the missing `node` declaration. Update protocol or generated authoring schema fixtures if their
snapshots include validation examples.

Phase 4 is complete when the manifest tests pass and a client-only plugin cannot install a route that
can only return 404.

## Phase 5: Preserve markers in the terminal projection

`apps/tui/src/chrome/Rail.tsx` calls `resolveRailMarkers` and renders only `placed`. That is a desktop
geometry answer. A terminal row has no corners, so it must consume the resolver's complete ordered
legend or an equivalent complete ordered list.

Keep these constraints:

- Preserve the same priority and id ordering as the desktop allocator.
- Render icon and dot representations through the TUI kit.
- Keep the task title as the part that yields width; marker state stays at the trailing edge.
- If all glyphs cannot fit, draw a `+N` indicator and provide a host-owned, keyboard-reachable reading
  of the omitted labels. Do not add plugin-owned interaction.
- Do not change desktop placement rules to accommodate the terminal.

Document the chosen compact behavior in `docs/tui.md`. Phase 5 is complete when the TUI test proves
that five or more competing markers do not disappear silently.

## Phase 6: Complete verification and manual QA

Run focused verification after each phase:

```sh
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/protocol test
pnpm --filter @acorn/node-core test
pnpm --filter @acorn/tui test
```

Run repository gates after the focused suites pass:

```sh
pnpm lint
pnpm test
pnpm --filter @acorn/desktop test
```

Add these checks to the release smoke checklist in `docs/testing.md`, then run them once:

- Check Terminal, Modern, Cozy, and Cute style packs.
- Check source, task, pane, run, terminal, add, and close controls at rest, hover, focus, active, and
  busy.
- Confirm the left add control and right close control occupy equal 52-pixel boxes with aligned
  dividers.
- Confirm project accent stripes stay on the left and right-rail active stripes stay on the right.
- Confirm a task with pin, Docker, unread, working, dirty, checks, and loaded-plugin annotations has no
  overlapping markers and lists every accepted state in its tooltip and accessible description.
- Confirm reduced-motion mode stops marker and busy animation.
- Confirm task-row menus still anchor to the rail button and return focus after dismissal.
- Change a loaded plugin's task status without changing the task list. Confirm the marker refreshes
  after plugin push, global status, and declared polling.
- Disable, enable, reload, and remove the loaded plugin. Confirm its marks disappear and return with
  the contribution lifecycle.
- Switch between two nodes containing the same task id. Confirm neither node displays the other's
  marks.
- In the terminal client, show more than four task markers and confirm none disappears without an
  overflow indication and inspection path.

Record the completed manual pass in `docs/testing.md` according to that document's convention.

## Phase 7: Move ownership and delete this file

Update the contract owners after the code and verification are complete:

- `docs/plugins/cooperative-extension-points.md`: document `core:task`, its `{ task: string }` key, the
  batched POST, provenance, contributor isolation, freshness, budgets, and task-only scope.
- `docs/plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md`: keep the compiled
  `ctx.railMarkers` contract, then explain that loaded task markers use `extensions` plus
  `core:task`. Remove the statement that loaded plugins cannot publish markers and the promise of a
  rail-specific manifest twin.
- `docs/plugin-authoring.md` or its owning extension-point topic: add a complete manifest and route
  example for contributing to `core:task`. State that an `items` route requires a node bundle and that
  the response contains display data only.
- `docs/contribution-kinds.md`: keep Rail markers as a compiled contribution. Explain that loaded task
  status arrives through the loaded `Extensions` annotation carrier. Remove the planned manifest-twin
  direction.
- `docs/ui-design.md`: retain the desktop allocator, legend, accessibility, priority, and placement
  rules. Link loaded task data to the annotation contract instead of this file.
- `docs/frontend.md`: describe how annotation freshness joins the existing chrome revision and
  contribution lifecycle without a per-row query.
- `docs/tui.md`: document the one-dimensional marker projection and its overflow behavior.
- `docs/testing.md`: own the automated layers and manual rail checks added in Phase 6.
- `docs/future/compiled-tier.md`: remove the claim that Docker waits on a rail-marker manifest twin.
- Source comments in `packages/protocol/src/extensionPoints.ts` and
  `packages/client-core/src/host/annotations/taskAnnotations.ts`, plus their tests: point to the owning
  plugin or UI document instead of `docs/future/rail-tab.md`.

Then retire this plan:

1. Run `rg -n "future/rail-tab|rail-tab.md" docs packages apps plugins` and remove every live
   reference except the retirement entry described below.
2. Remove the `rail-tab.md` row and relationship sentence from `docs/future/README.md`.
3. Add `rail-tab.md` to the retired-files paragraph in `docs/future/README.md`. State that the rail
   component and compiled marker contract live in `docs/ui-design.md` and the loaded task path lives in
   `docs/plugins/cooperative-extension-points.md`.
4. Delete `docs/future/rail-tab.md`.
5. Run the documentation path test through the full `pnpm test` command and confirm no link or source
   comment points at the deleted file.

## Done criteria

Do not delete this file until every item is true:

- [ ] Annotation state is partitioned by contributor and includes node, descriptor, freshness, and
      visible keys in request identity.
- [ ] Plugin-specific freshness refetches only that plugin's annotations.
- [ ] Disable, enable, reload, removal, and node switch cannot retain stale marks.
- [ ] Late or failed requests cannot overwrite a newer scope or another contributor.
- [ ] The generic raw response ceiling and the `core:task` 256-mark accepted limit are enforced and
      tested.
- [ ] Route-backed `items` and `route` extensions require a node bundle.
- [ ] The loaded manifest-to-POST-to-rail path has an integration test.
- [ ] The terminal client preserves or explicitly discloses markers beyond the four desktop corners.
- [ ] Source and pane loaded markers are documented as out of scope, after verifying no real consumer
      needs them.
- [ ] Focused package tests, `pnpm lint`, `pnpm test`, and the desktop test suite pass.
- [ ] The manual rail and annotation lifecycle checks are recorded in `docs/testing.md`.
- [ ] Owning documents describe the final contract without contradiction.
- [ ] No production source or documentation points to this file.
- [ ] `docs/future/README.md` records the retirement.
- [ ] This file is deleted.

## Stop conditions

Stop and report instead of improvising if:

- A real loaded plugin needs source or pane markers. Design and verify the matching owner-declared
  point with that plugin before widening scope.
- Freshness requires one request, timer, observer, or subscription per task or control.
- The annotation lifecycle cannot consume `chromeDeps` without introducing a dependency cycle across
  the client registry and chrome layers. Report the cycle and move the revision accessor to the lowest
  shared plain TypeScript module instead.
- A global response count low enough for the rail truncates legitimate diff annotations. Keep the
  generic and point-owned budgets separate.
- Clearing a removed contributor requires clearing marks from contributors that did not change.
  Partition the store rather than accepting the broader invalidation.
- Preserving terminal overflow requires plugin-owned interaction or a desktop component in the TUI.
  Use a host-owned compact disclosure instead.
- A change would make annotation completion order determine display order or provenance.
- A proposed fix puts plugin JSX, CSS, geometry, or actions into the annotation response.
- Any focused suite fails before implementation for a reason unrelated to this plan. Record the
  baseline failure and keep it separate from this work.

