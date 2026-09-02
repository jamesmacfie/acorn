# Phase 2: a Notifications settings page

Shipped 2026-09-02. Settings → Notifications sits beside Appearance and the gate reads what it
writes. Where each part landed:

- `packages/client-core/src/features/notifications/settings.ts` holds the `NotificationSettings`
  type, `DEFAULT_NOTIFICATION_SETTINGS`, and `parseNotificationSettings`, which reads every missing
  or malformed field as on. `deliver.ts` imports all three from there rather than declaring them.
- `packages/client-core/src/features/settings/NotificationSettings.tsx` is the page: two channel
  checkboxes, three event checkboxes under **Notify me when**, and **Send a test notification**.
- `PrefKeys.notifications` and its `DEVICE_KEYS` line are in
  `packages/client-core/src/infra/persistence/prefKeys.ts` and
  `packages/client-core/src/infra/persistence/devicePrefs.ts`.
- `apps/desktop/src/client/pageContributions.tsx` registers the page at order 15.
- `docs/features.md` § Settings and fleet names it; `docs/state-ownership.md` § Scope rules puts the
  settings on the device.

## Where the build departed from the requirements

**The gate reads the device store, not the prefs query** (requirement 3). The requirement had
`deliver.ts` read `prefsOptions` in `packages/client-core/src/infra/queries.ts`. The gate is a plain
module with no component around it and no query client to hand, and this key never reaches a node:
`savePref` routes a device key to `localStorage` and only then to the cache. So
`readNotificationSettings()` reads `readDevicePrefs()` directly, which is the same value with none
of the plumbing, and works unchanged on the terminal client, where there is no store and every
switch reads as on. The page still reads through `prefsOptions`, because it is a component and wants
the reactivity.

**The test button goes through `deliverNotice`, not `deliver`** (requirement 5). `deliver` holds an
edge for a second and re-checks it against the snapshot map, and a synthetic session has no
snapshot, so the edge would always be dropped. `deliverNotice` is the half of the gate the button
wants: the seen rule and the channels. `focused` is forced false so the notice is unseen wherever
you happen to be standing.

**Five checkboxes, not six.** The badge switch waits for the seam that draws the number, which is
phase 4's. Requirement 4 already said absent rather than disabled; this records that the absence is
what shipped.
