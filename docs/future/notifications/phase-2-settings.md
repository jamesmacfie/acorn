# Phase 2: a Notifications settings page

Design, 2026-09-02. Not started. Depends on phase 1 (there is a gate to read the settings from).

## Goal

Settings → Notifications exists, beside Appearance, with six checkboxes and a test button. The gate
reads the preference. An install with no preference behaves exactly as phase 1 left it.

## Why

The user asked for it, and [analysis.md](./analysis.md) finding 13 says every piece of the mechanism
exists: a page registry, a preference key list, a device-key list, a write helper, and a 65-line
template. Phases 3 and 4 need a place to hang their toggles before they build the channels.

## Requirements

1. `PrefKeys.notifications = 'notifications'` in
   `packages/client-core/src/infra/persistence/prefKeys.ts`, with a comment saying it is the
   device's, like `theme`: a sound on this machine is not a fact about the node.
2. `PrefKeys.notifications` is added to `DEVICE_KEYS` in
   `packages/client-core/src/infra/persistence/devicePrefs.ts`.
3. `packages/client-core/src/features/notifications/settings.ts` (new) exports the
   `NotificationSettings` type from [model.md](./model.md) § Settings, `DEFAULT_NOTIFICATION_SETTINGS`
   with every field `true`, and `parseNotificationSettings(json: string | undefined): NotificationSettings`,
   which fills every missing or malformed field with its default. The gate from phase 1 reads
   `parseNotificationSettings(prefs[PrefKeys.notifications])` through `prefsOptions` in
   `packages/client-core/src/infra/queries.ts`.
4. `packages/client-core/src/features/settings/NotificationSettings.tsx` (new) follows
   `packages/client-core/src/features/settings/AppearanceSettings.tsx`: `createQuery(() => prefsOptions(true))`
   to read, `saveJsonPref` from `packages/client-core/src/features/settings/savePref.ts` to write, kit
   `Checkbox` and `Field` from `packages/client-core/src/kit/components/primitives`. Labels:
   **Play a sound**, **Show a system notification**, **Show the unread count on the app icon**,
   and under a **Notify me when** field, **An agent needs me**, **An agent finishes**,
   **An agent fails**. The badge checkbox renders only where the host installs `setBadge`
   (phase 4); until then it is absent, not disabled.
5. A **Send a test notification** button runs a synthetic edge (`blocked`, title "Test agent needs
   you", task id of the active task or empty) through `deliver` with `seen` forced to `false`, so
   every enabled sink fires. In phase 4 this is also where the system notification permission is
   requested.
6. `apps/desktop/src/client/pageContributions.tsx` gains
   `{ id: 'notifications', label: 'Notifications', group: 'general', order: 15, component }`, lazy
   like its neighbours.
7. `docs/features.md` § Settings and fleet adds the word "notifications" to the list of sections.

## Design notes

**One JSON key, not six.** `docker_prefs`, `exclusive_slots`, and `disk_warning_acked` set the
pattern: a preference read together is stored together, and six keys would need six `DEVICE_KEYS`
lines and a migration if a seventh appears. The parser's defaults are the migration.

**Why the event toggles remove the row too.** [model.md](./model.md) § The gate: off means the
owner does not want to hear about it. A row that lands silently and counts in the pill is hearing
about it.

**Why the badge row hides rather than greys.** A greyed control with a tooltip is the pattern
`docs/frontend.md` refuses for seam-gated affordances: hide the button that cannot work. The seam
group tells the page whether it can.

## Files

- `packages/client-core/src/infra/persistence/prefKeys.ts`: the key.
- `packages/client-core/src/infra/persistence/devicePrefs.ts`: the device-key line.
- `packages/client-core/src/features/notifications/settings.ts` (new): type, defaults, parser.
- `packages/client-core/src/features/settings/NotificationSettings.tsx` (new): the page.
- `packages/client-core/src/features/notifications/deliver.ts` (new in phase 1): reads the parsed settings.
- `apps/desktop/src/client/pageContributions.tsx`: the entry.
- `docs/features.md`: one word.

## Tests

- `packages/client-core/src/features/notifications/settings.test.ts` (new): `undefined`, `"{}"`,
  malformed JSON, and a blob missing `events` all parse to the defaults; a blob with
  `"sound": false` keeps everything else `true`.
- `deliver.test.ts`: an edge whose event toggle is off produces no row and calls no sink.
- The page renders in the jsdom `hosts` project of client-core with a fake query client, toggles
  a checkbox, and asserts `saveJsonPref` was called with the merged object.

## Acceptance

- Requirements 1 to 7 hold.
- Turning **An agent finishes** off and running the phase 1 acceptance sequence raises three rows,
  not four.
- Every existing test passes, including `tools/arch/boundaries.test.ts`.

## Doc moves when it ships

`docs/features.md` § Settings and fleet names the page. `docs/state-ownership.md` § Scope rules adds
"notification settings" to the device row. This file shrinks to a pointer.
