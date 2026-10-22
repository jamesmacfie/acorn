# Phase 3: plugin custody in the phone's browser

Date: October 23, 2026. Status: built on the open side. Runn's manifest change and the real-device checkpoint skipped. Depends on [phase 2](./02-sandbox-origin.md).

## Completion note

October 23, 2026, on branch `phase-3-browser-custody`.

What landed:

- `packages/custody/src/rules/` holds the custody decisions with no host in them: `BundleCache`, `TrustStore`,
  `pluginDecisions`, the request schemas, and `webCryptoSha256`. `@acorn/custody/rules` exports them. The desktop's
  `PluginCache` and `PluginTrustStore` are now these classes over files (`packages/custody/src/plugins/fileStorage.ts`), with the install
  and bundled-plugin paths that only a computer has. Their test files didn't change.
- `pluginDecisions` is the five answers every host gives (`state`, `cachePut`, `trustRecord`, `trustForget`,
  `devGrant`). The desktop helper and the terminal client each had their own copy. Both now call the shared one, so
  there is one place that records a decision, including the partial record when a disclosure doesn't parse.
- The phone's `plugins` group: `apps/mobile/src/client/pluginCustody.ts` over `pluginStorage.ts` (IndexedDB). It loads
  on first use. `platform.ts` installs the group only when the build names a sandbox domain. Opening custody gives the
  sandbox its source for bytes with `setTreeBundleSource`.
- `PluginTrustDialog` mounts lazily in the phone's shell with a new `bundlesOnly` prop.
- Two architecture rules in `tools/arch/boundaries.test.ts`: the rules folder imports no `node:`, no Node package, and
  nothing else in custody; and the phone may import `@acorn/custody/rules` and nothing else from custody.
- Docs: [the phone's plugin custody](../../mobile/plugin-custody.md), the pointers in
  [plugin bundles](../../security/plugin-bundles.md) and [the mobile web app](../../mobile.md), and the removed
  section in [mobile work after the first release](../mobile/later.md).

Decisions and deviations:

- **Inheritance, not wrappers.** `PluginCache extends BundleCache` and `PluginTrustStore extends TrustStore`. Every
  caller and test keeps its constructor and methods, and the rules sit in the base class.
- **Storage is synchronous for the index and the trust record, and asynchronous for bytes.** The rules read both
  documents as they run, so the phone reads them when custody opens and writes behind. Bytes are written first and
  awaited, so the index can't name bytes a failed write lost. Each phone answer waits for the write-behind to finish and
  rejects if it failed.
- **The `plugins` group is conditional.** A phone build with no `ACORN_SANDBOX_DOMAIN` has nowhere to run a bundle, so
  it doesn't keep or ask about one. Phase 2 left the domain unset, so without this every phone would prompt for code it
  can't run.
- **`bundlesOnly` on the trust dialog.** A phone's device may not write under `/v1/core/plugins`, so the Node's half of
  an answer (what a plugin reads, its skills) would fail there. The phone asks about bundles only, and a plugin that
  waits on those approvals still needs the desktop.
- **The button says "Accept plugin", not "Allow".** The phase text says Allow. The shared dialog's wording won.
- **`NodeResponseTooLargeError` moved to `rules/responseTooLarge.ts`** and `broker/nodeRequest.ts` re-exports it, so the
  rules and the broker throw and catch one class.
- **Phase 2's comment path.** `apps/mobile/sandbox/headers.mts` named a build output as a path, which the
  architecture suite's comment check refused. I reworded it.
- **A mismatch is reported in the log.** The phone shows no message of its own. The desktop doesn't either, and the
  distribution pass has no surface for one.
- **Skipped: Runn's manifest.** The `formFactor: ['desktop', 'mobile']` line goes in Runn's own repository, which I
  don't have. The manifest's word is `mobile`. The checks used a stand-in plugin with that line.
- **Skipped: checkpoint 5**, which needs an iPhone and an Android phone.

What later phases need to know:

- The phone keeps the bytes of every bundle a Node offers for a plugin that runs in the desktop app, accepted or not,
  as the desktop does. Phase 4's hash list can short-circuit the prompt in `pluginDecisions`' caller, or in the
  distribution model, and both go through the same `TrustStore`.
- The sandbox reads a bundle by hash and checks it. Nothing in `setTreeBundleSource`'s source checks that this phone
  accepted the hash. That gate is the distribution model's, as on the desktop, and it holds because only a selected,
  accepted bundle gets a tree mounted.
- A phone with no way to forget a decision keeps a denial until the site's storage clears. Revoking from the phone
  needs a screen (open question 1).
- The full suite has two red suites that come from phase 1's terminal pane and not from custody:
  `apps/desktop/test/client/clientPluginDisable.test.ts` expects 12 panes and gets 13, and the site's
  `keybindings.test.mjs` can't read the terminal's new shortcut registrations
  (`plugins/terminal/src/client/TerminalSessions.tsx`). Every other suite passes.
- The first screen grew by 4,141 B for the hook-up, from 506,722 B to 510,863 B. Phase 4 and 5 have about 9 KB below
  the ceiling.

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

## Design

**The storage interfaces** are in `packages/custody/src/rules/storage.ts`. `BundleStorage` has `readIndex`,
`writeIndex`, `writeBundle` (which can be asynchronous), and `keepOnly`. `TrustStorage` has `read`, `write`, and
`setAside`. The rules also take a hash function (`Sha256`) and a logger (`RulesLog`).

**The modules that moved** are in `packages/custody/src/rules/`. `bundleCache.ts` holds the cache decisions, and
`trustStore.ts` the trust record. `requests.ts` and `grantSchemas.ts` are the request schemas, which used to sit in the
plugins folder, and `decisions.ts` is new. The classes in `packages/custody/src/plugins/` stay as thin subclasses over
`fileStorage.ts`.

**The IndexedDB layout** is one database, `acorn-phone-plugins`, with `index`, `trust`, and `bundle:<hash>` keys
([the phone's plugin custody](../../mobile/plugin-custody.md#what-the-phone-keeps)).

**The architecture tests** keep `node:`, Node packages, and the rest of custody out of `rules/`, and let the phone
import `@acorn/custody/rules` and nothing else from custody.

## The design that was proposed

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
- [Mobile work after the first release](../mobile/later.md): remove the "Run loaded plugins on a
  phone" section.

## Open questions

- Where does a person revoke a plugin on the phone? The phone has no settings screen, and consent is
  per device, so revoking on the desktop doesn't reach it. A plugin list on the phone's Nodes screen
  is one answer. Deferred: it needs a screen, which is a product decision. Until then a denial or an
  acceptance lasts until the site's storage clears.
- Does iOS clear an installed home-screen app's IndexedDB? Safari can clear a site's storage after
  seven days without use. Say what the person sees after it happens. Partly answered: the phone treats a missing
  store as a device that has never seen the plugin, so the person sees the first-sight prompt again and the pane
  returns once they accept ([the phone's plugin custody](../../mobile/plugin-custody.md)). Whether an installed app
  loses its storage is a real-device question for checkpoint 5.

## Evidence

October 23, 2026. Playwright WebKit 2370 and Chromium 1234 at 390 by 844, against `pnpm dev:account`,
`pnpm dev:mobile`, and a standalone Node with remote access on. The Node's plugin was a stand-in with a task pane that
draws one line and `formFactor: ['desktop', 'mobile']`. I built it with `build-plugin.mjs` and served it to the Node
through `ACORN_BUNDLED_PLUGINS_DIR`.

| Checkpoint | Result |
| --- | --- |
| 1. The desktop and the terminal client are unchanged | Passed. `@acorn/custody`, `@acorn/desktop` helper, and `@acorn/tui` plugin tests pass with their test files untouched. In `pnpm dev:agent`, `plugins.install` from a folder cached the bundle and recorded it on the device. `trustRecord` accepted it, an install of a changed folder replaced the bundle under a new hash, `trustForget` removed the decision, and `remove` cleared the cache. I drove these through the bridge, not the Settings page. |
| 2. Stand-in in a phone-sized browser | Passed in WebKit and Chromium. The task showed the trust prompt for `runn-standin` with its permission line. After **Accept plugin** the **Runn** button joined the bar and the pane drew its text, with no `.contribution-failed`. |
| 3. Reload, update, deny | Passed in WebKit, and the reload in Chromium. After a reload the pane drew with no prompt. Rebuilding the plugin with one more permission prompted again under "Plugin changed what it asks for", with the added line under "New in this version". **Reject update** removed the pane, and after a reload the phone asked nothing. |
| 4. Tampered bytes and lost storage | Passed in WebKit. Deleting `acorn-phone-plugins` brought the first-sight prompt back. A Node patched for this check to append bytes to the bundle made the phone log `does not match the hash it advertised; refusing the bundle`. It showed no prompt and no pane. The Node's own route refuses a file that differs from its hash, so the lie needed that temporary patch, which I reverted. |
| 5. iOS and Android | Skipped. It needs the owner's phones and the hosted sandbox domain. |

Unit tests: `pluginCustody.test.ts` runs the real rules over a map standing for IndexedDB and covers the same
behaviors, plus a failed write, forgetting a Node, and the sweep. `rules.test.ts` runs the rules over asynchronous
storage with Web Crypto.

The phone's first screen: 510,863 B of scripts and 126,786 B of styles, against 520,000 B and 128,000 B. The same
build at the phase 2 commit measured 506,722 B of scripts, so the phase added 4,141 B.

Seen and not chased: WebKit logged one `Refused to apply a stylesheet` message from a frame on the first run. Chromium
logged nothing. It's outside this phase's code.

## Verify before building

Recheck `PluginCustody`'s members and the custody classes' imports against your checkout. Check that
phase 2's relay accepts bytes from the phone.
