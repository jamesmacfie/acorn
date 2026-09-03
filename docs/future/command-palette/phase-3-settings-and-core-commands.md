# Phase 3: expose deliberate settings and organize core commands

Planned 2026-09-03 at `7d62e3ec`. Shipped 2026-09-03.

## Status

- Priority: P2
- Effort: medium
- Risk: medium; duplicate preference paths can silently drift.
- Depends on: phase 2

## Purpose

Add the setting variant, factor shared preference accessors, and replace the root's ad-hoc task and
workspace rows with core-owned grouped/search commands. This is the first user-visible catalogue
expansion and the proof that the palette changes product state without owning it.

## Prerequisites

- Search/input and loaded command adapters from phase 2 are stable.
- Read Appearance, Notifications, Terminal, Docker, and Agent defaults pages plus their preference
  schemas and persistence-slice ownership.
- Read task/workspace/node selection and pane layout commands; preserve their current navigation and
  confirmation paths.

## Behavioural changes

- Selecting a setting command opens explicit choices and marks the current value. A successful write
  stays in the frame, updates the marker, and announces status.
- Boolean settings use On/Off choices rather than a blind toggle.
- Root navigation becomes named core commands and groups. Task/workspace discovery retains fleet
  behavior but is no longer a special palette item kind.
- Settings pages are reachable as actions, while only deliberately registered simple fields are
  directly editable.

## Boundaries

### In scope

- Compiled and loaded setting command contracts.
- Shared domain accessors for approved simple settings.
- Core groups/searches/actions for navigation, panes, task creation/archive, terminal drawer, and
  Settings pages.
- Removal of task/workspace special cases from palette orchestration after parity.

### Out of scope

- Schema-generating all Settings UI, complex forms, numeric tables, secrets, destructive plugin/node
  administration, or plugin-specific search adoption.

## Migration steps

1. Add setting frames to the shared session: load current value, render 2–32 choices, select one,
   write once, use the returned canonical value, remain open, and surface errors without optimistic
   false state.
2. Add the compiled `read/options/write` contract. Add the loaded descriptor with static options and
   confined read/write routes; GET returns `{ value }`, PUT receives derived scope plus `{ value }`
   and returns `{ value }`. Reject undeclared values at both host and plugin boundaries.
3. Regenerate and re-check the manifest JSON Schema. Use a fixture loaded plugin for setting
   behavior; no production loaded first-party setting is needed merely to prove the seam.
4. Factor accessors used by both Settings UI and commands:
   - Appearance: style, follow-system, fixed theme, light theme, dark theme;
   - Notifications: sound, system, platform-supported badge, blocked/finished/error events;
   - Terminal: default drawer profile, text size, startup context injection;
   - Docker: destructive confirmation and showing stopped containers;
   - Agents: carry last session settings and default tool-card expansion.
   Accessors preserve existing defaulting, validation, query-cache update, and persistence scope.
5. Register core groups and commands for Go to, Panes, Terminal, and Settings. Settings-page children
   are generated from `settingsRegistry`; editing commands are separately explicit descendants.
6. Implement task, workspace, project, and node searches over existing caches/fan-out. Reuse current
   activation order: switch node before activating a remote task or workspace.
7. Move current pane commands, task archive, terminal drawer, shell creation, Settings open, and task
   creation under the graph without changing their existing guards or confirmations.
8. Remove task/workspace special item kinds and invoke switches from the palette only after parity
   tests prove the command versions. Keep other compatibility rows for phases 4–5.

## Tests

- Current-value loading, checked option, canonical write response, failure, retry, and `stay` state.
- Boolean On/Off idempotence and unavailable platform-specific badge command.
- Loaded setting route confinement, static option bounds, and rejection of unknown returned/written
  values.
- Appearance writes immediately update the palette's tokens through the same query cache as Settings.
- Notification JSON merges preserve unrelated switches.
- Terminal, Docker, and Agent default/fallback semantics are identical from page and command accessors.
- Core task/workspace searches preserve fleet identity and navigation order.
- Pane conditions and guarded archive behavior match phase 0 characterization.
- Root query finds nested settings by breadcrumb.

Run:

```sh
UPDATE_PLUGIN_SCHEMA=1 pnpm --filter acorn-plugin-types test
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/plugin-terminal test
pnpm --filter @acorn/plugin-docker test
pnpm --filter @acorn/plugin-agents test
pnpm --filter @acorn/tui test
pnpm --filter @acorn/desktop test
pnpm lint
```

If a plugin package uses a different actual package name, take it from its `package.json`; do not
guess or skip the scoped suite.

## Exit criteria

- Approved settings have one domain accessor used by page and command.
- Complex and secret settings remain pages and are absent from palette search.
- Core navigation, task/workspace, pane, and Settings rows are graph commands with no palette item
  switch for their old kinds.
- Both hosts show and persist identical setting choices where the host capability exists.
- Existing confirmations and navigation order remain intact.

## Rollback posture

Keep Settings pages authoritative throughout. A setting command can be unregistered without losing
the underlying preference or page. Core task/workspace adapters may remain for one release switch
during development, but remove the switch before phase exit once parity is demonstrated.

## STOP conditions

- A proposed setting cannot share exactly the page's reader/writer.
- A setting requires free text, dependent fields, secret handling, or a save transaction across
  several values.
- Core navigation needs a plugin-specific import or special case.
- Moving archive or pane actions bypasses an existing availability/confirmation gate.

## Verify before starting

- Inventory every current preference key and its app/device/node ownership before extracting an
  accessor.
- Confirm the current theme list and style list remain dynamic functions, not stale constants.
- Re-read notification platform capability and merge/default rules.
- Confirm Settings registry and modal navigation APIs still accept a named page.
- Re-run phase 2 loaded descriptor and cross-host tests.

