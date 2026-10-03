# Package boundaries

This page states the rules for what each package may import and what it publishes. Read it before
you add a package, an export, or an import that crosses a package. [Conventions](../conventions.md)
covers file and folder names.

## How the rules are enforced

Three mechanisms hold the boundaries:

- **A test.** `tools/arch/boundaries.test.ts` checks the import graph of every package in `apps/`,
  `packages/`, `plugins/`, and `tools/`. A package's kind comes from where it lives, never from its
  name. `.github/workflows/ci.yml` runs it on every pull request.
- **Exports maps.** Every plugin and library publishes an enumerated list of subpaths. A deep import
  is a `tsc` error at the import site. The test checks every map for wildcards, missing targets, test
  files, and private imports. A map that went back to `"./*": "./src/*"` would break no build, so the
  test is what catches it.
- **Types.** The UI kit is closed by type. Every component a plugin may draw is one row in
  `packages/client-core/src/kit/tokens/support.ts`. Its props are role tokens, not DOM attributes,
  and a type-level test refuses `class`, `className`, and `style`. [UI design](../ui-design.md)
  § The closed kit covers the kit.

Test files follow the same rules as production files unless a rule names an exception. Shrinking
baselines are named in their own tests.

## Library exports

`@acorn/protocol` has no single entrypoint, so its exports map lists its public modules one per line.
A test file isn't importable from another package, and a new module is public only when someone adds
its line. The source is grouped by contract owner: agents, appearance, chrome, content, data,
dashboards, device, integrations, projects, runtime, and transport. The public subpaths stay flat, so
moving a file between folders doesn't change any import. `plugin/` and `tree/` keep their own wire
families. `baseline.ts` stays at the source root because the Rust shell embeds it.

The other libraries also publish enumerated subpaths:

| Library | Public paths | Kept private |
| --- | --- | --- |
| `client-core` | Feature, registry, kit, and infrastructure entrypoints, plus narrow component paths for lazy UI | Feature stores, registry implementations, and test helpers outside `testkit/` |
| `node-core` | Server service and composition seams, and `testkit` for fixtures | Runtime implementations the map doesn't name |
| `custody` | Broker, plugin custody, device, and startup seams | Store and supervision internals |
| `dashboards-core` | Contract, projection, and rendering math | Pipeline modules the map doesn't name |
| `diff-document` | One entrypoint, `./document`: the diff document's types, parser, segmenter, search, and parse cache | Its modules behind that entrypoint |

A direct path stays where a lazy component import, a side-effect stylesheet, a mock target, a
composition entrypoint, or two exports with the same name need their own loading boundary. Public
files re-export only the bindings used across packages.

Within `client-core`, the kit depends on its own modules and the syntax highlighter, not on product
features. It also imports public protocol and diff-document contracts. The test counts type-only
imports and re-exports, so a display shape shared with a feature belongs in the kit.

## Shared libraries

Three libraries hold code both runtimes import:

- **`packages/protocol`** holds the error envelope, Node identity, pairing, the broker and service
  protocols, the WebSocket envelope, and the core resource types. It declares no plugin's routes.
- **`packages/dashboards-core`** holds the dashboard pipeline: the panel model and codec, shaping,
  cross-source mapping, layout, and chart and cell arithmetic. It has no Solid, registries, or fetch.
  The Node's measure sampler computes a panel's number with the same functions the renderer draws it
  with, so a stored number means what the number on screen means. [Schedules](../schedules.md) covers
  the sampler.
- **`packages/diff-document`** builds the diff viewer's document on the Node and reads it in the
  renderer. It parses a patch into rows, cuts them into bounded segments, describes the layout without
  the text, and searches. It has no DOM, Node, Solid, database, transport, or provider type. A plugin
  may import it directly because it holds no host state. [Diff rendering](../diff-rendering.md)
  § The document covers it.

Like protocol, `dashboards-core` and `diff-document` declare no DOM and no Node types, which keeps the
standalone Node's import graph clean.

## Graph shape

There are no cycles. `packages/*` never imports `plugins/*`, because a plugin whose only upstream is
`@acorn/protocol` closes no cycle, so acyclicity alone wouldn't catch the inversion. Apps never import
each other.

## What a plugin may import

A plugin may import the facade, `@acorn/plugin-api`, the wire types, another plugin's `contract/`,
and its own files. Nothing else in `packages/`. `contract/` is the one cross-plugin import path, and it
may not re-export a package's internals, even through another file. A chain such as
`contract/x.ts -> shared/y.ts -> server/heavy.ts` would pull the implementation into every consumer.
Types a contract needs live in `contract/` or `shared/`.

Plugin tests reach core fixtures through `@acorn/plugin-api/testkit` and its client subpaths. The test
refuses a plugin test that imports `client-core` or `node-core` directly.

## What an app may import

An app may import a plugin's public subpaths and no internal module, so a composition root can't come
to depend on something that was never meant to be public. A plugin declares only the kinds it has:

| Subpath | For |
| --- | --- |
| `./node/index.ts` | The Node activation entrypoint |
| `./client/index.ts` | The client activation entrypoint |
| `./contract/*` | The cross-plugin surface, open as a directory |
| `./testkit` | What a Node-side test outside the package needs |
| `./testkit/client` | The same for a client-side test, kept apart so DOM types stay out of a Node program |

`linear` and `rollbar` also declare `./server/index.ts`, because a `vi.mock` has to name the module
the code under test imports. The test holds that list at two.

No production file imports any package's `testkit/`. That's how a temporary-directory SQLite factory
would end up shipped.

## Folder names

A plugin's `src/` children come from seven names: `node`, `server`, `client`, `tree`, `contract`,
`shared`, and `testkit`. No loose files. Every rule that keys off the first path segment reads it as
one of these, so an eighth name wouldn't be refused. It would fall through to `shared` and stop being
governed. `node/` holds the activation entrypoint and its Drizzle schema and nothing else, because
it's the one folder an app imports by path.

No test sits under a `contract/`, because its wildcard subpath would make the test importable. No
folder is named `main`, `service`, or `wiring`. Every workspace package carries a one-line
`description`. The test checks all of these.

## Runtime rules

- **The Node stays bootable.** Tauri's `invoke` and event API are confined to
  `apps/desktop/src/shell/`, the bridge the window injects. Nothing imports `electron`, including in a
  manifest. The composition-root suites under `apps/node/test/integration/` boot every plugin's
  `node/index.ts` in plain Node.
- **Every runtime logs through a logger.** `console.*` is a shrinking baseline in the Node and client
  runtimes. A line written through `createLogger` carries an owner, passes a scrubber, and reaches
  every sink. What survives in a baseline isn't a log line: a handshake a launcher parses, a pairing
  banner, or a plugin frame's own console. Tests are exempt, because they spy on `console` to check
  the logger. [Telemetry](../telemetry.md) § Logging covers the logger.
- **The custody stack stays shell-free.** `@acorn/custody` is the broker, fleet, device tokens, plugin
  cache and trust store, tunnels, and supervised Node service. It names no shell binding, and its
  encryption is injected. The desktop runs it in a helper process, and the terminal client runs it in
  process. [Shell](../shell.md) covers the helper.
- **The client stays portable.** Only `packages/client-core/src/infra/platform/` reads `window.acorn`.
  It's a global, so this is a source scan. Tests are exempt, because stubbing `globalThis.window` is how
  the platform code gets tested.
- **Core seams can't be reached around.** The raw identity store is confined to `packages/node-core`
  and the two composition roots that build it. The plugin trust and bundle stores are confined to
  `@acorn/custody`, because trust binds to a hash the host computed and the renderer must stay inert.
  A plugin's production code never imports core's `db` module. Every child process goes through the
  process broker, except a written list: a PTY, a long-lived agent driver, a `docker logs -f` stream,
  and a pg client.

## Protocol owns no plugin's wire surface

Workflow rows and inputs live in Workflows' `contract/wire.ts`. Managed agent sessions and events live
in Agents' `contract/wire.ts`. Core tool ceilings live in `toolPolicy.ts`, and the attention snapshot
in `attention.ts`. Every plugin route is under `/v1/p/<plugin>/` and core's are under `/v1/core/`, so
one literal catches a route builder protocol doesn't own. The protocol modules named for a plugin are
an enumerated, shrinking list, each with a stated reason.

## The facade stays plain

`@acorn/plugin-api` holds re-exports only: no declarations and no plain imports. Only the two UI
barrels may re-export a `.tsx` module, so every other entrypoint loads in a plugin's Node-environment
test suite. `ui/` may import only pure or presentation modules, from an allowlist of destinations.

## Two context types per side

`NodePluginContext` and `ClientPluginContext` are what a plugin loaded from disk gets.
`CompiledNodePluginContext` and `CompiledClientPluginContext` add the seams only a compiled plugin can
have: a live Hono router, WebSocket channel and PTY stream slots, agent tools, context sections, model
adapters, and the client registries that take a component. The tier line is in the types, so crossing
it is a compile error. [Plugins](../plugins.md) § The two contexts, one per tier owns the pair, and
[contribution kinds](../contribution-kinds.md) says why each kind sits where it does.

## Two spellings that must not drift

`PLUGIN_ROUTE_SEGMENT` is declared in client-core and spelled again as a literal in
`packages/node-core/src/server/plugins/manifest.ts`. The client is downstream of the Node and can't
share the constant. The test turns a drift into a failure, instead of a route the device refuses after
the Node accepted it.

## Two renderer traps

A contribution's props may not declare `ref` as data anywhere in
`client-core/src/host/registries/`. Solid rewrites `ref={value}` on a component into a callback, so
the panel reads `props.ref.displayId` as `undefined`. TypeScript can't see it, because `ref` lives on
`IntrinsicAttributes`.

A CSS class defined in a plugin's stylesheet may not be used by markup outside that plugin. Otherwise
a pane loses its styling when an unrelated plugin is switched off.
