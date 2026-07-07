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
- The help screen and command palette derive from registries.
- `dev:node` has no bridge crashes for gated contributions.
- `window.alert` / `confirm` count is zero.
- Pane layout persists pane set, order, id-keyed weights, and pins across
  relaunch; maximize remains session-only.
- Unknown persisted ids remain inert and retained.
- Keyboard navigation satisfies pane conformance: tab focuses panes, lists use
  roving navigation, and pane-local chords fire only while focused.
- Registry-rendered contribution failures degrade to inert placeholders.

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
