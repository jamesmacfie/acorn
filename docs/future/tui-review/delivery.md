# Complete terminal journeys and release checks

Date: October 8, 2026. Status: remaining implementation and acceptance handoff.

Start from [the review entry page](./README.md). Startup, reconnect repair, setup, Settings routing,
local-path file transfers, promotion, and PTY navigation are implemented. Confirm those paths rather
than repeating their original implementation phases.

## Complete applicable settings

Start with `apps/tui/src/chrome/settingsPages.tsx` and the shared settings registry.
Use [Terminal Settings](../../tui/sources-and-settings.md#settings) to identify implemented forms
and pages that display **desktop app**.

For each applicable page, provide a terminal form or a documented working command/configuration path.
Keep Node and device scope explicit. Reuse validation, defaults, save guards, and permissions.
Do not introduce a second settings store.

Acceptance: a clean terminal profile can configure a provider or installed CLI, Node access,
necessary task defaults, and schedules without desktop interaction. Failed validation retains input;
Escape honors unsaved changes; restarting preserves settings at their documented scope.

## Verify the feature inventory

Use [the journey table](./features.md) as the acceptance checklist. Reproduce a gap before changing code.
For each applicable feature, record discovery, navigation, principal action, visible result, failure,
and recovery at 80 by 24 and 120 by 40.

Prioritize these unclosed paths:

1. Provider connection and authentication, then source browse and task promotion.
2. Disposable Git stage, commit, push, and review writes, with post-action refresh.
3. Real installed agent CLIs, permissions, questions, queueing, export, artifacts, and managed/PTY
   handoff. Verify return to the managed transcript and retained task identity.
4. HTTP requests and PostgreSQL execution against disposable local fixtures.
5. Workflow edit, publish, run, gate, retry, and schedule configuration.
6. Offline/revoked Nodes, loaded-plugin trust and updates, and recovery of a reused session.

Editor implementation and local evidence are in [Editor acceptance](../editor/README.md).
Reuse its contract and completion records. Finish any terminal-specific journey that the feature
inventory needs; do not rebuild its completed menus, navigation, or scoped search.

## Fix presentation failures

Inspect a selected object's full identity, status words, primary action, and keyboard help at both
sizes. Move large action sets into an accessible menu when they consume the row's identity.
Use [host projections](./host-projections.md) to preserve each fact formerly conveyed by an icon.

Treat dashboard table/list projection as a separate scoped task when a decision depends on data
otherwise absent from the terminal. Keep preview webviews unavailable and provide an external URL
or another documented path when applicable. A placeholder is a host limit, not feature acceptance.

Acceptance: controls report an unavailable capability before invoking it, errors offer recovery,
and menu dismissal restores focus to a surviving target. Check legacy keyboard mode, resize while
inside a PTY, and return to the task after the PTY exits.

## Verify package boundaries

After fixes and focused checks pass, run these gates:

1. `pnpm lint`, affected owner and consumer suites, and the architecture suite.
2. The unfiltered `pnpm test` with the repository's supported runtime and bounded concurrency.
3. The isolated terminal navigation flow and targeted journeys from a fresh profile at both sizes.
4. A desktop session with the same seed. Compare counts, data, action results, and error states.
5. Extracted standalone artifacts outside the checkout. Verify every required runtime module resolves,
   local start and attach, remote pairing, shutdown ownership, and installed-plugin loading.

[Node packaging](../bundle.md) owns artifact publication. Record an unavailable platform artifact
as an open release check, not as a successful checkout test.

## Definition of done

Each journey has dated evidence or an accepted host limit with a working alternative.
A terminal-only user can set up a project, start and supervise work, inspect results, recover,
and exit safely. Packaged artifacts pass the startup and ownership checks.

Record tested commit, runtime, terminal, sizes, fixtures, commands, results, and open platform limits.
Update the owning reference pages with changed behavior and remove this review folder after its
acceptance records and remaining proposals have an owning home.

## Verify before building

- Recheck registrations, Settings support, platform capabilities, and fixture isolation.
- Consult dated evidence before counting a journey as untested or failed.
- Verify real action results; rendering a form or passing a mocked handler does not prove the journey.
