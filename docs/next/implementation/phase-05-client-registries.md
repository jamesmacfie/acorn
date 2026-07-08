# Phase 5 — Client registries

**Status:** planned · **Depends on:** Phase 3 for capability probes recommended
· **Gated by:** smoke suite · **Primary docs:** [extensibility](../extensibility.md)
§3 and §9, [contribution-points](../contribution-points.md) §4,
[ux](../ux.md), [ui-state](../ui-state.md).

## Goal

Open the client extension seams without moving folders yet. Panes, commands,
keybindings, settings pages, capabilities, events, UI slots, notices, themes,
notification kinds, and content links become registries or typed services.

This phase is the largest client-side change and should be delivered as several
independent PRs.

## Architectural Context

Current UI extension points are closed lists and switch statements. Adding a
pane touches type unions, labels, order, shortcuts, body rendering, and switcher
buttons. Keybindings live in many listeners. Settings pages and command palette
rows are hardcoded. This phase makes core own mechanisms and features own
contributions.

Target flow:

```text
feature contribution -> registry -> shell host -> capability gate -> error boundary
```

Unknown persisted contribution ids are retained but inert.

## Required Context

Read these sections before implementation:

- [extensibility.md](../extensibility.md) §3 defines the plugin unit,
  activation, UI slots, cross-plugin extension, and UI composability; §9
  describes the order of operations.
- [contribution-points.md](../contribution-points.md) §4.1, §4.3, §4.4, §4.6,
  and §4.13 define panes, commands, keybindings, settings pages, and smaller UI
  registries.
- [inventories.md](../inventories.md) §3a-§3h are the checklists for pref keys,
  keydown listeners, module-scope keyed collections, panes, command actions,
  mailbox signals, alert/confirm sites, and polling sites.
- [ux.md](../ux.md) §1, §4, §5, §7, and §8 specify will-phase confirmation,
  keybindings, visible errors, pane management, and non-regression invariants.
- [ui-state.md](../ui-state.md) §2 names current state-reaction failure modes;
  §3 gives the rules for visible failures and latest-wins behavior.
- [state-and-policies.md](../state-and-policies.md) §5.1 defines state tiers and
  ownership; Phase 6 will turn the persisted pieces into descriptors.
- [feature-parity.md](../feature-parity.md) §12, §15, and §17 cover settings,
  notifications/unread behavior, and degraded browser mode.
- [testing.md](../testing.md) §1 and §4 define smoke and conformance gates.

This phase opens client extension seams. It should not move folders or invent
the final plugin layout. The output is registries/services that later foldering
can reveal mechanically.

## Implementation Plan

1. Pane registry.

   Add `PaneContribution` and derive `PANE_IDS`, labels, order, shortcuts,
   switcher buttons, and body rendering from it. Fix the `pr` pane contract so
   it takes `{ task }` instead of reading global route params.

2. Pane management.

   Add resize dividers, id-keyed persisted weights, pinning, focus-directed
   maximize, and move/reorder. Extend `TaskLayout` with optional
   `weights?: Partial<Record<PaneId, number>>` and `pinned?: PaneId[]`.

3. Command registry.

   Replace hardcoded command palette actions. Formalize run targets, recipes,
   and workflows as palette item providers.

4. Keybinding registry.

   One dispatcher owns registration, conflict detection, remapping, and the help
   screen. Preserve existing capture-phase and modifier-disambiguation behavior.
   Add `when: 'pane'` scope driven by focused-surface state.

5. Settings-page registry and typed settings services.

   Replace `SettingsModal.tsx`'s tab list. Keep existing pages behaviorally
   intact. Integrations remain hardcoded provider cards until Phase 7 replaces
   them with provider descriptors.

6. Client capability metadata.

   Panes, commands, settings pages, overlays, and tools declare required
   capability: `none`, `desktop`, or named residue capability. Hosts gate
   unavailable contributions consistently.

7. Client event bus and will-phase.

   Convert preview eviction call sites and mailbox signals into event
   subscriptions and pane intents. Add timeout-bounded concern collection for
   destructive events such as close task, archive, workspace removal, and quit.

   Give event payloads plain serializable data and namespaced string kinds (no
   live signals, closures, or DOM refs), and keep runtime/session events (agent/
   session status, workflow step, PTY / worktree / task / workspace lifecycle)
   distinct from pure presentation events (open overlay, selection) — so a future
   events-over-WS projection is additive rather than a rewrite of every emitter
   ([security.md](../security.md) §9 seam 2).

8. Slot error boundaries and UI kit seed.

   Wrap registry-rendered contributions in error boundaries. Seed `client/ui/`
   with shared controls, token-skinned headless primitives, `QueryGate`, and
   common form wrappers.

9. Keyboard-navigation primitives.

   Add list navigation, `use:paneFocus`, and overlay focus scope/trap so pane
   keyboard conformance is achievable by default.

10. One error surface.

    Retire `window.alert` / `confirm` call sites as features convert. Foreground
    mutations use inline errors; background work uses notices.

11. Smaller registries.

    Add theme contributions, notification-kind contributions, content-link
    contributions, and initial task-status poller contributions where owned.

## Design Guardrails

- **Extensibility:** shell hosts render contributions; feature modules declare
  them. A new pane, command, settings page, or notification kind should not edit
  switch statements in the shell.
- **Simplicity:** registry objects should be small and local to feature
  ownership. Avoid a generic plugin runtime in this phase.
- **Robustness:** capability gates, error boundaries, unknown-id retention, and
  will-phase timeouts are not polish; they are required failure containment.
- **Maintainability:** keep persisted layout shape id-keyed and versionable so
  Phase 6 can add codecs without reverse-engineering UI effects.
- **External-control forward-compatibility:** the event bus is client-side, so it
  is the one control-relevant surface the transport collapse does not put on the
  wire. Keep runtime/session events serializable and stably named, and distinct
  from pure presentation events, so a future events-over-WS projection is
  additive, not a rewrite of every emitter ([security.md](../security.md) §9
  seam 2).

## Slice Order

1. Pane registry only.
2. Pane management and `use:paneFocus`.
3. Command registry.
4. Keybinding registry.
5. Settings-page registry and capability gates.
6. Event bus and will-phase.
7. UI kit, error boundaries, keyboard primitives.
8. Error-surface and small-registry cleanup.

## Acceptance Criteria

- Adding a pane is one contribution file plus one registration line.
- Adding a command, keybinding, settings page, notification kind, theme, or
  content-link follows the same contribution pattern and does not require shell
  switch edits.
- The help screen and command palette derive from registries.
- `dev:node` has no bridge crashes for gated contributions.
- `window.alert` / `confirm` count is zero.
- Pane layout persists pane set, order, id-keyed weights, and pins across
  relaunch; maximize remains session-only.
- Unknown persisted ids remain inert and retained.
- Keyboard navigation satisfies pane conformance: tab focuses panes, lists use
  roving navigation, and pane-local chords fire only while focused.
- Registry-rendered contribution failures degrade to inert placeholders.
- The will-phase gathers close/archive/quit concerns with a timeout and shows
  the [ux.md](../ux.md) §1 confirmation semantics.
- All keydown listeners in [inventories.md](../inventories.md) §3b are either
  migrated to the dispatcher or explicitly justified as local input handling.
- Mailbox signals in [inventories.md](../inventories.md) §3f are replaced by
  typed events or pane intents.
- Client docs describe registry ownership and capability gates as the shipped
  extension mechanism.

## Verification

- `pnpm lint`
- `pnpm test`
- Smoke S3.
- Pane conformance suite over all panes.
- Keyboard walkthrough using [inventories](../inventories.md) §3b as checklist.
- Pane management manual pass: drag, pin, show, move, maximize, relaunch.
- `dev:node` pass for palette/help/settings rows with unavailable capabilities.
- Alert/confirm grep.

## References

- [review.md](../review.md) §1a, §4 and recommendations #5, #8.
- [inventories.md](../inventories.md) §3a-§3h.
- [contribution-points.md](../contribution-points.md) §4.1, §4.3, §4.4,
  §4.6, §4.13.
- [state-and-policies.md](../state-and-policies.md) §5.
- [ux.md](../ux.md) §1, §4, §5, §7, §8.
- [ui-state.md](../ui-state.md) §2 and §3.
- [feature-parity.md](../feature-parity.md) §12, §15, §17.
- [docs-overhaul.md](../docs-overhaul.md) §2 for frontend and panes docs.
