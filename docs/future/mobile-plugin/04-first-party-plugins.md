# Phase 4: the first-party plugins on the phone

Date: October 23, 2026. Status: built. Real-device checkpoint skipped. Depends on [phase 3](./03-browser-custody.md).

## Completion note

October 23, 2026, on branch `phase-4-first-party-plugins`.

What landed:

- `bundledAck` in `packages/custody/src/rules/bundledAck.ts` turns a built manifest and a client bundle's hash into the
  acceptance the desktop records for its own bundles. `trustBundledClientPlugins` now calls it, so the desktop and the
  phone build one acceptance the one way. `bundledPluginTrust.test.ts` is unchanged.
- `apps/mobile/scripts/build-first-party.mjs` builds the roster with `buildBundledPlugins`, hashes each client bundle, and
  writes the acceptances to `apps/mobile/first-party-bundles.json` (ignored by Git). `pnpm --filter @acorn/mobile build`
  runs it first, and so does `pnpm dev:mobile`. `vite.config.ts` hands the file to the app as
  `__ACORN_FIRST_PARTY_BUNDLES__`. Six bundles carry: agent-cost, database, http, linear, rollbar, and
  sentry-telemetry. model-providers has no client.
- `openPluginCustody` records a carried acceptance when a fetched bundle's plugin id and computed hash match. That list
  lives in the custody chunk, so the first screen is unchanged. The page is
  [the phone's plugin custody](../../mobile/plugin-custody.md#first-party-bundles).
- `formFactor: ['desktop', 'mobile']` on the task panes of Database, HTTP (`http`, not `http-project`), Rollbar, and
  Linear (`linear`, not `linear-issue` or the reference panel). agent-cost needed nothing.

Decisions and deviations:

- **Where the match happens.** In the phone's `cachePut`, right after the rules have hashed the bytes. The desktop records
  at launch because it holds the bytes on disk. The phone holds none until a Node offers them, and recording at the same
  moment means only bytes this phone hashed itself are trusted. It overwrites an earlier decision for the same hash, as
  the desktop's launch pass does.
- **The disclosure is the build's.** The recorded acceptance carries the declaration and grants from the manifest the
  build wrote, not the Node's. A Node that keeps the bytes and changes the declaration prompts, as on the desktop.
- **No `NODE_ENV` in the build script.** Loading anything through Vite sets `NODE_ENV=development`, and the first run built
  different bytes, so no hash matched. The script clears it before it builds, and loads the TypeScript only afterward.
- **A missing file means nothing carried.** Every bundle then asks. I chose this over failing the build, because it errs
  toward a prompt and lint and tests run with no file.
- **Three shared fixes the panes needed**, each found at 390 by 844:
  1. A plugin's toolbar overflowed on a phone: the Database bar was 483 px in a 390 px column, with Run off the edge. In
     `primitives.css`, a toolbar inside a remote tree wraps on a phone, and its heading asks for its own width.
  2. Database's results were unreachable. The kit's `ListDetail` shows the detail when the pane's `selection` changes, and a
     query's rows belong to no table. The plugin now reports `'query'` as the selection.
  3. The update prompt read "You approved true." `Show`'s callback got the `&&` result instead of the version. It now
     gets the version. A test pins it. The drift prompt is the first screen most people will see this on.
- **HTTP shows its list after a tap.** A loaded plugin's panes have no way to report a selection, so the layout keeps the
  list and offers **Show detail**, as the layout doc describes. The pane works, but it takes two taps. A selection report
  for loaded panes would fix it, and I didn't build one.
- **`knip.jsonc`** ignores unused exports in `rules/public.ts`, because the build script loads `bundledAck` through Vite.

What later phases need to know:

- The first screen is 511,198 B of scripts against 520,000 B, and 127,017 B of styles against 128,000 B. The styles rule
  added 231 B, so styles have about 1 KB left.
- Phase 3 measured 510,863 B. I didn't isolate the 335 B between that and now, and none of this phase's code is in the first
  screen.
- Carried acceptances must be rebuilt with the Node. The account website builds the phone on its own schedule (open
  question 1), so a Node update the phone hasn't caught up with prompts once per plugin whose bytes changed, which is the
  design.
- Checkpoint 5 still needs the owner on an iPhone and an Android phone.

## Goal

Database, HTTP, Rollbar, Linear, and agent-cost draw on the phone. When the phone and the Node come
from the same release, the phone trusts them with no prompt, as the desktop does.

## What works at the end

A person opens a task on the phone and finds the Database, HTTP, Rollbar, and Linear panes in the bar
where the task has something for them. agent-cost draws in the agents pane's header. None of them
prompts while the releases match. After a Node update that the phone build hasn't caught up with, each
one prompts once.

## Starting point

- `scripts/bundled-plugins.mjs` builds the seven bundled packages for the desktop and the standalone
  Node.
- `packages/custody/src/plugins/bundledPluginTrust.ts` accepts them at every desktop launch. It reads
  their declarations from app-owned resources, so a Node can't widen them by claiming the same hash
  ([the application's own bundles](../../security/plugin-bundles.md#the-applications-own-bundles)).
- The task panes: Database is `document-over-frame`, a host document over a tree. HTTP is `list-detail`
  with trees. Rollbar and Linear are `single` trees. The narrow projections of those layouts are in
  [narrow layouts](../../mobile/narrow-mode.md#narrow-layouts).
- agent-cost contributes a tree to the agents pane's session header through an extension point.
  Extension points have no `formFactor`, so it needs no opt-in.
- model-providers has no client half, and sentry-telemetry has only a settings page, so neither draws
  on the phone.
- The account website serves the phone app, built by `pnpm --filter @acorn/mobile build`, on a
  schedule apart from Node releases.

## The design to confirm

- **Carry the hashes.** The phone build reads the output of `buildBundledPlugins` and writes each
  plugin's ID, hash, and declaration projection into a module that loads with custody, not with the
  first screen. The phone's custody accepts a matching hash with the same projection the desktop
  records. A Node on another release offers other hashes, and those prompt.
- **Opt in surface by surface.** Add `formFactor: ['desktop', 'mobile']` to each task pane once it's
  been checked at phone width. Fix what doesn't fit in the shared component, not in the plugin
  ([what holds across every phase](../mobile/README.md#what-holds-across-every-phase)).

## In scope

- Hashes in the phone build, and the check in the phone's custody.
- The opt-in for the Database, HTTP, Rollbar, and Linear task panes.
- Any fix the panes need in client-core's narrow layouts or the kit.

## Out of scope

The HTTP and Rollbar project panes, Linear's issue panel, and settings pages. The phone has no screen
for them.

## Steps and checkpoints

### 1. Write the design

Name the generated module, where the build reads the bundles from, and how custody marks a decision
it took with no prompt.

### 2. Hashes in the phone build

**Checkpoint 1: no prompt when the releases match.** Build the phone and run a Node from the same
checkout. Open a task on the phone. No first-party plugin should prompt.

**Checkpoint 2: a prompt on drift.** Change one line in Database's client, rebuild only the Node, and
open the task. Database should prompt once, and the others shouldn't.

### 3. Each pane at phone width

**Checkpoint 3: every pane draws.** In Playwright WebKit at 390 by 844, open a task with a database
URL, saved HTTP requests, Rollbar items, and a linked Linear issue. Each pane should draw, with no
"This view stopped working". Open a detail in HTTP and come back with **Back**. Run a query in
Database.

**Checkpoint 4: agent-cost.** Open an agent conversation. The cost should draw in its header.

### 4. Real phones

**Checkpoint 5: iOS and Android.** On both phones, repeat checkpoints 1 and 3.

## Acceptance

- The four task panes and agent-cost draw on both phones.
- No prompt while the releases match, and one prompt per plugin after they drift.
- The phone's first screen stays under its ceiling.

## Docs to update when it ships

- [Plugin bundles](../../security/plugin-bundles.md#the-applications-own-bundles): the phone's
  first-party hashes.
- [Features](../../features.md#phone): the installed plugins a phone draws.
- [The mobile web app](../../mobile.md): which installed plugins draw.

## Open questions

- How often does the account website ship the phone app, compared with Node releases? That decides how
  often people see the drift prompt. Deferred: it's a hosted-service schedule that this repository can't see. Until it's
  answered, the phone and the Node match only when the website's build and the Node's come from one commit.
- Should the phone build carry the hashes of the last few releases, so a Node one release behind
  doesn't prompt? Deferred, with a reason: each old hash is trust with no prompt for bytes this build never read. Doing it
  safely needs the older builds' manifests, and a person can always accept the prompt once.

## Evidence

October 23, 2026. Playwright WebKit 2370 and Chromium 1234 at 390 by 844, against `pnpm dev:account`, `pnpm dev:mobile`,
and a standalone Node with remote access on, started from this checkout with `ACORN_BUNDLED_PLUGINS_DIR` set to a build of
`buildBundledPlugins`. The task had a Postgres `DATABASE_URL`, three saved HTTP requests, a linked Rollbar item, and a
linked Linear issue. Rollbar's and Linear's APIs were stand-ins: a local HTTPS server and an HTTP proxy with a throwaway CA,
reached through `NODE_USE_ENV_PROXY`. A plugin worker's environment is scrubbed, so the check needed a temporary patch to
`isolation.ts` that passed the proxy variables through. I reverted it before the commit. The task also held an imported
agent transcript, with a usage event written into its database, for agent-cost.

| Checkpoint | Result |
| --- | --- |
| 1. No prompt when the releases match | Passed in WebKit and Chromium. The pane bar listed Database, API, Linear, and Rollbar, with no dialog. |
| 2. A prompt on drift | Passed in WebKit. I rebuilt the Node with a changed Database client and left the phone's list alone. The phone prompted once, for `database`, and the others didn't. The prompt read "You approved true", which the dialog fix covers. |
| 3. Every pane draws | Passed in WebKit and Chromium with no `.contribution-failed`. Database drew its editor and, under **Show panel**, the tables. A query returned 3 rows. API drew the list, **Show detail** drew the request, and **Back** returned to the list. Linear and Rollbar drew their issue and error. |
| 4. agent-cost | Passed in WebKit. The conversation header drew `$1.37`. |
| 5. iOS and Android | Skipped. It needs the owner's phones. |

Before the three fixes, Database's toolbar pushed Run off the screen and a query's rows never appeared. Both were seen
in WebKit and fixed in the shared code.

Unit tests: `pluginCustody.test.ts` covers a carried hash that is accepted and stays accepted after a reload, the same hash
under another plugin id, and a hash the build doesn't carry. `PluginTrustDialog.test.tsx` pins the version in the update
prompt. The custody, mobile, client-core, plugin, and architecture suites pass, and so do `pnpm lint`, the desktop's client
goldens, and the site's keybinding test.

The phone's first screen: 511,198 B of scripts and 127,017 B of styles, against 520,000 B and 128,000 B.

Seen and not chased: WebKit logged `Refused to apply a stylesheet` for the plugin trees, as in phase 3. Linear logged
`Card dropped props: pad` from its own tree. Rollbar's tab strip crowds its **Occurrences** tab against the status chips
at 390 px.

## Verify before building

Recheck the bundled roster in `scripts/bundled-plugins.mjs` and each plugin's surfaces in its
`acorn-plugin.config.mjs`.
