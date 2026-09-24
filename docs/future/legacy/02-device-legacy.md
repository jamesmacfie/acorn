# Ticket 02: Remove custody and preference adoption

Date: 2026-09-21. Status: implemented. Prerequisites: 01.
Read [context](./context.md), F07 in [findings](./findings.md), and [reset policy](./reset-and-versioning.md).

## Outcome

Fresh clients read one preference representation and never adopt credentials or settings from a
previous installation.

## Work

- Remove `adoptLegacyCustody` and the desktop helper handshake's legacy payload. Remove the Rust
  Electron safe-storage key lookup and its callers, retaining the current keychain cipher and helper handshake.
- Remove `seedDevicePrefs`, `drainMigratedPrefs`, and query-layer migration calls. Keep device preference
  reads/writes and the merge of correctly owned device and Node preferences.
- Remove startup purging of retired localStorage namespaces. The explicit reset and later baseline
  namespace prevent them from being loaded; production startup has no history-specific cleanup pass.
- Remove `pane_shortcuts`, `legacyPaneAction`, their preference slice/settings plumbing, and fallback
  resolution. Keep canonical keybinding overrides, including clearing or disabling a binding.
- Remove the task-layout active/pinned conversion. Canonical layout parsing retains valid optional
  fields, unknown plugin pane IDs, and validation of malformed input.
- Replace adoption tests with fresh-storage/rejection tests. Update owning state, shell, and shortcut docs.

## Acceptance

New desktop and terminal state starts with defaults; saving a preference remains stable across restart.
Switching Nodes never copies task-scoped layout between Nodes. Canonical bindings override defaults,
and obsolete binding/layout inputs do not activate. The helper boots without reading an Electron key.
Run `pnpm lint`, affected client/custody tests, and desktop boot/Rust tests. Verify shortcuts and layout
restoration in the real desktop window using isolated data.

## Verification, 2026-09-23

- `pnpm lint`: passed, 34 package checks.
- `pnpm --filter @acorn/client-core test`: passed, 210 files and 1,727 tests.
- `pnpm --filter @acorn/custody test`: passed, 8 files and 95 tests with loopback access.
- `pnpm --filter @acorn/desktop test`: build, 102 Vitest tests, and 38 Rust tests passed with
  loopback access. In the restricted sandbox, listener tests failed with `listen EPERM`.
- In an isolated Tauri window, Shortcuts showed the new-task binding as Unbound after using its
  control. A new task on the existing checkout switched to Notes, and pinning it showed `Unpin
  Notes`. The screenshot is under `.acorn/agent-dev/ticket02-device-retry/screenshots/`.
- Two restarts of that isolated profile reached `Acorn could not start — Importing a module script
  failed` after Vite module requests were reset by peer. Both sessions were stopped. Shortcut and
  layout restoration across a real-window restart remain unverified.
- `pnpm --filter @acorn/tui test` was attempted with loopback access. Three telemetry tests timed
  out or failed before the run stalled; it was stopped. Terminal TypeScript passed in `pnpm lint`.

## Verify before building

Trace all callers of the seed/drain functions and the Rust legacy handshake members. Preserve ordinary
storage-unavailable handling; private browsing and a terminal host without localStorage are valid cases.
