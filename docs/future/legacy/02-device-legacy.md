# Ticket 02: Remove custody and preference adoption

Date: 2026-09-21. Status: not started. Prerequisites: 01.
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

## Verify before building

Trace all callers of the seed/drain functions and the Rust legacy handshake members. Preserve ordinary
storage-unavailable handling; private browsing and a terminal host without localStorage are valid cases.
