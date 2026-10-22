# Phase 4: the first-party plugins on the phone

Date: October 23, 2026. Status: proposed. Depends on [phase 3](./03-browser-custody.md).

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
  often people see the drift prompt.
- Should the phone build carry the hashes of the last few releases, so a Node one release behind
  doesn't prompt?

## Evidence

None yet.

## Verify before building

Recheck the bundled roster in `scripts/bundled-plugins.mjs` and each plugin's surfaces in its
`acorn-plugin.config.mjs`.
