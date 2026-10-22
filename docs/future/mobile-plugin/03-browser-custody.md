# Phase 3: plugin custody in the phone's browser

Date: October 23, 2026. Status: proposed. Depends on [phase 2](./02-sandbox-origin.md).

## Goal

The phone fetches an installed plugin's bundle from the Node, checks its hash, keeps it, asks the
person to trust it, and draws it. Runn is the first plugin to do this.

## What works at the end

On the phone, a task with Runn shows a trust prompt that lists Runn's permissions. After **Allow**,
the Runn pane is in the bar and draws. After a reload, it draws with no second prompt. An update to
Runn prompts again and shows what changed.

## Starting point

- `PluginCustody` in `packages/client-core/src/infra/platform/index.ts` has seven members: `state`,
  `cachePut`, `install`, `remove`, `trustRecord`, `trustForget`, and `devGrant`.
  `packages/client-core/src/infra/platform/contract.ts` checks that a host implements all of them or
  none.
- Client-core reaches custody only through `packages/client-core/src/host/plugins/host.ts`. With no
  custody, every caller reads "nothing installed".
- `PluginCache` and `PluginTrustStore` in `packages/custody/src/plugins/` hold the rules: hash what
  arrived, refuse a mismatch, bind a decision to a hash and to the declaration the person reviewed,
  and prefer the highest version this client speaks. They read and write files with `node:fs` and
  import from `@acorn/node-core`.
- The terminal client reuses both classes unchanged, pointed at its own directory
  (`apps/tui/src/plugins/custody.ts`).
- The desktop mounts `PluginTrustDialog` from `packages/client-core/src/host/trust/` as an overlay.
  The phone mounts `PairingRequestDialog` lazily in `apps/mobile/src/client/Shell.tsx`.
- Runn's manifest lives in Runn's own repository and declares no `formFactor`.

## The design to confirm

- **Split the rules from the storage.** Move the decisions in `PluginCache` and `PluginTrustStore`
  into modules with no `node:` import, behind a small storage interface. Files stay the storage for
  the desktop and the terminal client, and IndexedDB is the phone's. An architecture test keeps
  `node:` imports out of the rules, as one does for `@acorn/channel`.
- **Hashing.** The rules take a hash function. The phone passes `crypto.subtle.digest('SHA-256')`, so
  both runtimes share one comparison.
- **The phone's `plugins` group.** `apps/mobile/src/client/platform.ts` implements it over the browser
  storage. `cachePut` fetches `GET /v1/core/plugins/:id/bundles/:hash` over the channel. `install` and
  `remove` refuse with "Install plugins from the desktop", because the phone holds no device plugins.
  `devGrant` behaves as on the desktop.
- **Where the bytes go.** The worker factory reads the bytes from the phone's store and posts them to
  the relay page from phase 2. On the desktop, the renderer never sees a bundle's bytes. On the phone
  it does, because the page is the only process.
  [Browser plugin custody](../remote.md#implement-browser-plugin-custody) accepts that.
- **Lost storage.** A browser can clear IndexedDB. The phone treats a missing store as a device that
  has never seen the plugin, and prompts again.

## In scope

- The split, with the desktop's and the terminal client's tests passing unchanged.
- The IndexedDB storage, the `plugins` seam group, and the list in `platform.test.ts`.
- `PluginTrustDialog` on the phone, loaded lazily.
- Runn: add `formFactor: ['desktop', 'mobile']` to its pane, in Runn's repository.

## Out of scope

Trust with no prompt for first-party bundles, which is phase 4. Installing plugins from the phone,
which is a non-goal.

## Steps and checkpoints

### 1. Write the design

Name the storage interface, the IndexedDB layout, the modules that move, and the architecture test.

### 2. Split the custody rules

**Checkpoint 1: the desktop and the terminal client are unchanged.** Run the custody, desktop helper,
and terminal client tests. In `pnpm dev:agent`, install a plugin from a folder, accept it, update it,
and revoke it. Each step should behave as before.

### 3. The phone's custody

**Checkpoint 2: Runn in a phone-sized browser.** Install Runn on the Node. In Playwright WebKit at 390
by 844, open a task that has a Runn stack. The trust prompt should name Runn and its permissions.
After **Allow**, the Runn pane should draw.

**Checkpoint 3: reload, update, and deny.** Reload. The pane should draw with no prompt. Rebuild Runn
with one more permission. The prompt should show the added line. Deny it and reload. The phone should
remember the denial.

**Checkpoint 4: tampered bytes and lost storage.** Serve a bundle whose bytes don't match the hash the
Node advertised. The phone should refuse it and say so. Clear the site's storage. The prompt should
come back.

### 4. Real phones

**Checkpoint 5: iOS and Android.** On both phones, through the relay and the hosted sandbox, repeat
checkpoints 2 and 3.

## Acceptance

- Runn draws on both phones after one prompt, and again after a reload with no prompt.
- An update prompts with what changed, and a denial sticks.
- A tampered bundle doesn't run.
- The desktop and the terminal client behave as before.
- The phone's first screen stays under its ceiling.

## Docs to update when it ships

- [Plugin bundles](../../security/plugin-bundles.md): custody in the phone's browser.
- [The mobile web app](../../mobile.md#limits): remove "Loaded plugins don't run".
- [Mobile work after the first release](../mobile/later.md#run-loaded-plugins-on-a-phone): remove the
  section.

## Open questions

- Where does a person revoke a plugin on the phone? The phone has no settings screen, and consent is
  per device, so revoking on the desktop doesn't reach it. A plugin list on the phone's Nodes screen
  is one answer.
- Does iOS clear an installed home-screen app's IndexedDB? Safari can clear a site's storage after
  seven days without use. Say what the person sees after it happens.

## Evidence

None yet.

## Verify before building

Recheck `PluginCustody`'s members and the custody classes' imports against your checkout. Check that
phase 2's relay accepts bytes from the phone.
