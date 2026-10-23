# The phone's plugin custody

This page covers how the [mobile web app](../mobile.md) keeps a plugin's bundle and decides whether to run it. Read it
before you change `apps/mobile/src/client/pluginCustody.ts`, its storage, or `packages/custody/src/rules/`. The
desktop's and the terminal client's version is [third-party plugin bundles](../security/plugin-bundles.md).

## One set of rules, three kinds of storage

`packages/custody/src/rules/` holds what the desktop, the terminal client, and the phone share. `BundleCache` fetches a
bundle from a Node, hashes what arrived, refuses a mismatch, and keeps it under the hash it computed. `TrustStore` binds
a decision to a plugin and a hash, with the declaration the person reviewed. `pluginDecisions` parses each request from
the client and answers it, so every host records the same decisions the same way.

The rules reach no host. They import no `node:` module and nothing from the rest of `@acorn/custody`, and
`tools/arch/boundaries.test.ts` fails on one that does. A host hands them three things:

- **Storage.** `BundleStorage` and `TrustStorage` in `rules/storage.ts`. The index and the trust record are small text
  documents that the rules read once and write whole. Bundle bytes go through `writeBundle`, which can be asynchronous,
  and the rules store the bytes before they record the bundle.
- **A hash function.** The desktop and the terminal client pass `node:crypto`'s. The phone passes `webCryptoSha256`,
  which gives the same hex for the same bytes.
- **A logger.** `RulesLog`, which takes a message and its attributes.

`PluginCache` and `PluginTrustStore` in `packages/custody/src/plugins/` are the same rules over files, with what only a
computer does: installing a plugin from a folder and caching the bundles the app ships with.

## What the phone keeps

IndexedDB holds a database named `acorn-phone-plugins`:

| Key | Holds |
| --- | --- |
| `index` | The bundle index, as the text the rules write. |
| `trust` | This phone's decisions about bundles, the same way. |
| `bundle:<hash>` | One bundle's bytes. |

The rules read the index and the trust record as they run, and IndexedDB only answers later. So
`openPluginStorage` reads both when custody opens. A write goes to the rules' copy first and to IndexedDB behind it.
`flush` waits for the behind-writes. Each answer that changes a decision, such as `trustRecord`, waits for `flush`
before it returns. If IndexedDB refuses the write, the trust prompt shows the error.

A browser can clear this storage, and then the phone behaves as a device that has never seen the plugin. It fetches the
bundle again and prompts again. Two tabs of the app each keep their own copy of the record and write all of it, so the
later write wins. A lost decision means one more prompt, never a missed one.

## The `plugins` group

`apps/mobile/src/client/platform.ts` installs the `plugins` group only when the build names a sandbox domain
([the phone's plugin sandbox](./plugin-sandbox.md)). Without a domain a bundle has nowhere to run, so the phone doesn't
ask about it. The group's members load `pluginCustody.ts` on first use, after the first frame.

- `state`, `cachePut`, `trustRecord`, `trustForget`, and `devGrant` are `pluginDecisions`. `cachePut` fetches
  `GET /v1/core/plugins/:id/bundles/:hash` over the channel of the Node that offered the bundle.
- `install` and `remove` refuse with "Install plugins from the desktop." The phone holds no device plugins.
- Opening custody gives the sandbox its source for bytes (`setBundleSource`). It reads the bundle from IndexedDB,
  and the relay page checks the bytes against its own host name before it starts them.

On the phone the page is the only process, so the renderer can read a bundle's bytes. On the desktop it never does.
[Browser plugin custody](../future/remote.md#implement-browser-plugin-custody) accepts that.

## First-party bundles

The phone trusts the bundles that ship with its own release without a prompt, as the desktop does for the bundles in its
resource directory ([the application's own bundles](../security/plugin-bundles.md#the-applications-own-bundles)). Both
use `bundledAck` in `packages/custody/src/rules/bundledAck.ts`, which turns a built manifest and the hash of its client
bundle into the acceptance the trust store records. The desktop calls it at launch for what it finds on disk. The phone
build calls it once.

`pnpm --filter @acorn/mobile build` first runs `apps/mobile/scripts/build-first-party.mjs`. It builds the roster in
`scripts/bundled-plugins.mjs` with the function the desktop and the standalone Node use, hashes each client bundle, and
writes `first-party-bundles.json` in the phone's folder, which Git ignores. `vite.config.ts` hands the file to the app as
`__ACORN_FIRST_PARTY_BUNDLES__`, and only the custody chunk reads it, so the first screen doesn't grow. `pnpm dev:mobile`
runs the same script, so a Node started from the same checkout matches.

The script builds with no `NODE_ENV`. A dev server's value changes the bytes, and then no hash would match.

At run time `openPluginCustody` checks each bundle the phone fetches. When the hash the phone computed from the bytes and
the plugin id match a carried entry, it records that entry as accepted, with the disclosure the build recorded and not the
one the Node sent. The distribution model then finds an acceptance whose declaration equals the Node's, so nothing prompts.
A Node on another release offers other hashes, and they take the prompt below. A Node that keeps the bytes and changes the
declaration loses the match for the same reason it does on the desktop.

An empty list is safe: a build with no file carries nothing, and every bundle asks.

## The trust prompt

The phone mounts `PluginTrustDialog` lazily, with `bundlesOnly`. What a plugin reads and the skills it supplies are
approved on the Node, and a phone's device may not write under `/v1/core/plugins`, so the dialog asks only about
bundles and skips the Node's half of an answer. Those approvals stay with the desktop.

A first sight prompts with the permissions the manifest declares. An update prompts again and lists what it added. A
denial is remembered and doesn't prompt again. The phone has no screen that forgets a decision, so only clearing the
site's storage brings the prompt back.

## A bundle that doesn't match

A Node that serves bytes other than the ones whose hash it advertised gets `hash-mismatch`. The rules log an error,
keep nothing, and the plugin stays out of the pane bar. The phone shows no message of its own. It reports the failure
the way the desktop does, in the log.
