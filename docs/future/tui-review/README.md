# Finish terminal acceptance

Date: October 8, 2026. Status: core review repairs implemented; feature and packaged-release acceptance remain open.

Use this handoff to make the terminal client usable from a clean profile through task work and recovery.
[The terminal reference](../../tui.md) owns implemented behavior.
[Delivery and acceptance](./delivery.md) lists the work that remains.

## Starting point

The implementation includes startup dependency repair, text labels for controls, reconnect retries,
first-run setup, a Settings route, masked fields, local-path file operations, source-item promotion,
and raw PTY navigation. These are implemented paths to verify, not missing features to rebuild.

The dated [review evidence](./evidence.md) and its screenshots record the initial observations.
Tests and selected live flows cover task navigation, resizing, setup, and a disposable shell PTY.
They do not establish every provider journey or packaged installation.

Settings lists the shared page registry. Several pages show **desktop app** rather than a terminal
form; device-scoped desktop edits do not configure the terminal client's device preferences.
[Terminal Settings](../../tui/sources-and-settings.md#settings) owns that distinction.

## Remaining work

Complete terminal forms or documented command alternatives for applicable settings. Verify provider
connections, real feature writes, attachments/export/handoff, failure recovery, and remote pairing.
Check selected identities and primary actions at 80 by 24 and 120 by 40.

Dashboards need a separate product decision about useful table/list projections; the implemented
host displays placeholders for dashboard asides. Preview webviews remain unavailable. Record each
host limit and a usable alternative instead of marking an untested path passed.

## Read this folder

| File | Purpose |
| --- | --- |
| [Delivery and acceptance](./delivery.md) | Remaining tasks, dependencies, fixtures, and release gates. |
| [Feature inventory](./features.md) | Journey checklist and the evidence available for each feature. |
| [Navigation](./navigation.md) | Dated keyboard and readability findings to reproduce before fixing. |
| [Host projections](./host-projections.md) | Which controls the terminal draws, replaces, or explains. |
| [Review evidence](./evidence.md) | Dated observations; preserve these independently of later fixes. |
| [Open proposals](./open-doors.md) | Separate extension and renderer work. |
| [Scope decisions](./refused.md) | Decisions that limit terminal-specific changes. |

## Owners

The Node owns execution and stored data. client-core supplies shared queries, feature contracts,
and panes. `apps/tui` owns cell rendering, keyboard dispatch, token custody, chrome, and host adapters.
Place a feature rule with its shared owner and terminal presentation with the terminal host.

## Complete the review

Each feature-inventory row must have a passing journey or a deliberate documented host limit.
Record navigation, action, result, error, and recovery at both target sizes. Complete the clean-profile,
remote-pairing, desktop-comparison, and packaged-artifact checks before closing this folder.

## Verify before building

- Reproduce a dated finding against the target checkout before assigning its repair.
- Read the Settings registry, platform groups, current roster, and loaded-plugin contracts.
- Use isolated Node data and disposable provider resources for writes.
- Check shared desktop behavior after a change to client-core or kit contracts.
