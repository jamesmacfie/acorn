# Test layers

Tests are organized by runtime and by the boundary they check. This page says what each layer covers
and where its tests live. Read it to find the right place for a new test. The rules that read source
shape instead of running code are in [architecture rules](./architecture-rules.md).

The suite uses real temporary SQLite roots, real TLS listeners, and real child processes wherever
those are part of the behavior under test.

## Protocol and Node

- **Protocol tests** validate the Zod contracts, route builders, query keys, errors, and service
  messages.
- **Node-core tests** cover data roots, TLS, auth, pairing, idempotency, migrations, backups, audit,
  worktrees, process and filesystem guards, routes, and WebSocket behavior.
- **Scheduler tests** use an injected clock. Workflow schedule tests pair that clock with real
  temporary core and plugin databases. They cover catch-up, stable due and manual identities, restart,
  overlap races, gated descendants, baselines, continuation expiry, revoked authority, pause and
  delete, and daylight-saving gaps and folds, without sleeping.
- **The workflow-v2 transition test** copies a fixture and runs only against the copy. It checks the
  targeted reset and that unrelated tasks, links, connections, devices, schedules, and files survive.
  A second copy holds an active run and proves the preflight refuses before it exports or changes a
  row. Never point this test, or a manual transition, at your development data root.
- **The CLI suite** checks argument parsing, resource projection against golden JSON Schema examples,
  Node selection, writes, agent and workflow waits, plugin command validation, and local service
  ownership. Node-core route tests cover device-only plugin dispatch, scope checks, output validation,
  and keyed write replay. The archive smoke test starts a Node, reads it from a second CLI process,
  and stops it. [CLI](../cli.md) owns the output and exit contracts.

## Composition roots

Tests that need populated plugin registries go under `apps/node/test/integration/` or the desktop
integration tree. Test route protection through the real `createApp()` factory, not by mounting
middleware in the test. Standalone parity tests check that `dev:node` wires the same pure-Node
capabilities as the supervised Node.

The integration tree is grouped by what a suite boots:

| Folder | Holds |
| --- | --- |
| `lifecycle/` | Suites that start and stop a Node: spawn, shutdown, standalone parity, and enrollment. |
| `auth/` | Pairing and the token principals. |
| `pluginSystem/` | The loader, the disable path, and the manifests. |
| `plugins/` | Suites named for one plugin. |

A suite that fits none of these stays at the top level. Helpers that aren't tests live in
`apps/node/test/helpers/`, and the shell fixture lives in `apps/node/test/__fixtures__/`.

## The testkit

`packages/node-core/src/testkit/` holds core's test scaffolding. Every `@acorn/node-core/testkit/...`
import is test scaffolding by its path, and the architecture suite fails a production file that
imports one. `makeTestNodeContext` and `makeTestRequestContext` build a real host context, not a mock.
[Plugins](../plugins.md) § What is published, and what acorn promises about it says why.

- `testEnv()` builds the `c.env` bindings a route test needs.
- `testSecretEnv()` and `TEST_ENCRYPTION_KEY` mint the session key and the `SecretService` that seals
  with it, as a pair. A test that sets only one compiles, then fails at its first credential read.
  Every test uses the same 64-hex key, so a test can seal a credential with the key its `Env` uses.
- `workspacePluginMigrations()` and `makeTestPluginDb()` resolve a plugin's Drizzle migration chain
  from its id, as `<checkout>/plugins/<id>/migrations`. This works only from a source checkout, so a
  plugin developed elsewhere passes its migrations folder explicitly. The path names the `plugins/<id>/`
  segment instead of walking up from the caller, so it can't resolve to core's own chain at
  `packages/node-core/migrations`.

## Plugins

Each plugin tests its schemas, providers, routes, reconciliation, and client models with fixtures in
its own package. Every plugin's `vitest.config.ts` re-exports `plugins/vitest.shared.ts`, which defines
two projects:

- `logic` runs `.test.ts` files in plain Node, with Git config neutralized.
- `hosts` runs `.test.tsx` files under jsdom with `vite-plugin-solid`. A plugin can render a region it
  ships, such as the PR pane's navigator beside its diff.

A plugin test reaches the host through `@acorn/plugin-api/testkit/client`, never by importing
`client-core`. The "plugin tests reach core through the facade testkits" case in
`tools/arch/boundaries.test.ts` holds that rule.

Feature suites worth knowing about:

- **Managed-agent delegation** covers signed caller context, execute permission, inherited ceilings,
  child authorization, depth and live-count limits, MCP retry idempotency, provisioning recovery,
  structured results, wait and attention states, cancellation, and reports back to the owner. A real
  Claude Code or Codex login belongs to the manual checks.
- **Web activity.** The two captures under `plugins/agents/src/server/drivers/__fixtures__` are the
  authority for what each provider sends. They came from live runs against the pinned Codex CLI and
  Claude ACP adapter, with long strings and result lists trimmed, and each records its version. Codex's
  `findInPage` has no capture, so a unit case derived from `codex app-server generate-json-schema`
  covers it. The card is checked by `webToolCard.test.tsx` under jsdom and by
  `apps/tui/src/agentsWeb.test.tsx` in a cell buffer.
- **Typed-source authoring** has pure tests for invalidation, preview generations, compatibility
  order, conversions, and missing examples. jsdom tests check that typing changes metadata without
  querying records, and that provider text renders as text. Workflows' inspector suite checks it gets
  the same binding picker.
- **AI authoring** runs one bounded response loop under an API connection and under a text-only
  harness, with fake model sequences. They cover lookups, clarification, malformed replies, repair,
  limits, cancellation, untrusted record content, stale merges, apply, reject, undo, and recovery. Real
  provider runs aren't deterministic, so they stay a release check.
- **Workflow schedule editor** has a jsdom host test over the real kit tree and pure tests for
  previews, loop gating, limits, and device projections. Server cases check that a published
  dependency change keeps the approved snapshot and that a paused **Run now** is admitted.

## Client core

The client-core suite has two Vitest projects, split by file extension so a host test sits beside the
host it renders:

- `logic` runs `.test.ts` in plain Node with no Solid transform. A green run here says nothing about
  the UI.
- `hosts` runs `.test.tsx` under jsdom with `vite-plugin-solid`. It renders the seven contribution
  hosts: `SlotHost`, `TaskSlotHost`, `RefPanelHost`, `ContextMenuHost`, `TaskPaneHost`,
  `ExtensionPointHost`, and `ExclusiveSlotHost`.

The hosts are tested instead of individual panes, because order, capability gating, arbitration,
and error boundaries live in the hosts. A contribution under test renders a `<span>` with its own id,
so the tests check machinery, not pixels. `vitest.browser.setup.ts` is shared with the plugin host
suites. It installs jsdom's storage over Node 24's undefined process-level `localStorage`.

- **Annotations.** Lifecycle tests cover freshness per contributor, disable and enable, reload,
  removal, the same task id on two Nodes, stale responses, failure isolation, merge order, and
  cancellation. Protocol holds the 4,096-row ceiling, and client tests keep it apart from
  `core:task`'s 256-mark limit.
- **Exclusive chrome.** Tests cover core fallback for the task list, pane switcher, rail, and topbar,
  remote-tree failure reports, nested slot placement, and refusal of choices the host didn't offer.
- **The palette.** `host/registries/commands/sessionStore.test.tsx` drives the session directly: what
  the empty root lists, what typing searches, what Enter and Escape do. Both hosts run the same
  operations through their own keys, in `host/palette/paletteView.test.tsx` and
  `apps/tui/src/chrome/chrome.test.tsx`. `host/chrome/chromeRegister.test.ts` § "a loaded plugin's
  setting, end to end" runs a fixture setting through the real registry.
- **The platform seam.** `infra/platform/contract.ts` states what a live capability group looks like.
  `infra/platform/contract.test.ts` runs it against a mock host, and `apps/desktop/src/shell/bridge.test.ts`
  runs it against the object the shell installs. A host that renames a key then fails a test instead
  of hiding an affordance.

## Terminal client

The `tui` suite in `apps/tui` renders the kit to a cell buffer. It runs the bundle's own transform and
the app's renderer, with stdout as a buffer and no terminal behind it. It inherits the alias that
points `@acorn/plugin-api/ui` at the terminal kit, so a pane draws through the shipped code path.

Tests assert what a reader looks for on screen, not a snapshot of every cell. `Badge` draws `[text]`,
and a `Fold` draws `▸ label` shut and `▾ label` open. A cell snapshot would fail on every spacing change
and name no broken rule. The suite has these files:

| File | Checks |
| --- | --- |
| `src/kit/kit.test.tsx` | One case per kit node, checked against the kit so no node goes untested, plus whole panes at 80 by 24 and 120 by 40 and one case per layout. |
| `src/keys/keys.test.tsx` | The twin of client-core's `keys.test.tsx`, so the two key adapters can't drift, plus regression cases for reported keyboard faults. |
| `src/panes.test.tsx` | Each first-party pane at 80 by 24: its main content is on the first screen, no line is wider than 80 cells, and the pane didn't draw its error boundary. |
| `src/chrome/chrome.test.tsx` | The whole shell: topbar, rail, footer, Tab order, the rail collapsing below 100 cells, the palette, notifications, and quit. |
| `src/reachability.test.tsx` | Walks every keyboard stop on nine screens and checks one caret, live focus, footer labels, and that Escape climbs back to the rail. |
| `src/invariants.test.ts` | Focus rules that are facts about the source. |
| `src/plugins/plugins.test.tsx` | The loaded-plugin sandbox. See below. |
| `src/node/boot.test.ts` | The terminal client's boot. See below. |

Each pane case waits for the text it's about instead of a fixed time, because a pane's data comes from
a route and the first render in a fresh worker compiles everything the pane imports. The
reachability walk runs at 80 by 24, and also at 120 by 40 when `ACORN_TUI_WIDE` is set. CI sets it.
The wide pass doubles a three-minute file.

The plugin suite starts a `node:worker_threads` worker under `--permission` and hands it a bundle from
a real content-addressed cache. It checks that the batch the worker sent draws, and that a file the
worker wasn't granted doesn't open. It also checks custody: a bundle whose bytes don't match the
advertised hash is refused, and a re-decision replaces its row. Nothing in it skips, because the
painter is TypeScript and runs on the Node the repository pins. [The terminal client](../tui.md)
§ The runtime floor says why.

The boot test runs the real path against a fresh data root and config directory: a supervised
standalone Node, the real fleet store and token files, and the broker over pinned TLS. It checks that
a `/v1` request and the event socket authenticate. It also checks that a second `acorn` attaches
instead of starting a second Node, that a refused token reads as `revoked`, and that quitting drains
the child and releases the lock.

The agent driver has protocol, screen, and flow tests under `apps/tui/scripts/agent/`. A live PTY run
is opt-in, because it builds and starts a real Node. [Agent drivers](../local-development/agent-drivers.md)
has the commands.

## Desktop

Desktop integration tests cover the broker, fleet, persistence, plugin activation, and native seams.
[Desktop and large-surface tests](./desktop.md) covers the boot test, the Rust unit tests, and the
real-window checks.
