# Testing

Tests are organized by runtime and boundary. The suite uses real temporary SQLite roots, real TLS
listeners, and real child processes where those seams are part of the behavior.

## Commands

```sh
pnpm lint
pnpm test
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop test
pnpm db:check
```

`pnpm test` rebuilds native modules for plain Node and runs Vitest through Turborepo with bounded
concurrency, and reports every package rather than cancelling the rest on the first failure. Run it
rather than `turbo run test` directly: the bound is what keeps the suite honest. Many of these tests
spawn a real subprocess, mint a certificate, or run git, and turning the bound off oversubscribes the
machine badly enough that they time out while passing in isolation.

The desktop package's `test` stages the bundle inputs first, then runs its Vitest suites and the Rust
unit tests, so the boot test always exercises fresh artifacts.

Suites that do that kind of real work carry a 20-second test and hook timeout instead of Vitest's
5-second default, set in `packages/node-core/vitest.config.ts`,
`packages/desktop-helper/vitest.config.ts`, `apps/node/vitest.config.ts`, and
`plugins/vitest.shared.ts`. A genuine hang still fails; it takes longer to say so.

## Test layers

- protocol tests validate Zod contracts, route builders, query keys, errors, and service messages;
- the client-core suite is two vitest projects, split by file extension so a host test sits beside the
  host it renders. `logic` is `.test.ts` in bare Node with no Solid transform, which is what the whole
  suite used to be, and a green run there still says nothing about the UI. `hosts` is `.test.tsx`
  under jsdom with `vite-plugin-solid`, and it renders the seven contribution hosts: `SlotHost` and
  `TaskSlotHost`, `RefPanelHost`, `ContextMenuHost`, `TaskPaneHost`, `ExtensionPointHost`, and
  `ExclusiveSlotHost`. Hosts rather than individual panes, because ordering, capability gating,
  arbitration and the error boundaries all live in the hosts and every plugin's UI rides on them. It
  checks machinery, not pixels: a contribution under test renders a `<span>` carrying its own id. The
  smoke checklist below is still the eyes-on pass, and it is a good thing to run once after touching
  any of these;
- the three kit invariants hold the component set closed, and each one reads the contract rather
  than the code that implements it. `ui/kit/support.test.ts` reads the `/ui` barrel and asserts that
  the nodes it exports and the rows in `NODE_SUPPORT` are the same list, each with a terminal level.
  `ui/kit/roles.test.ts` asserts that every role token has a value on both hosts, and that the DOM
  value names a token `tokenAxes.ts` declares. `ui/kit/props.test-d.ts` has nothing to run: it is a
  type-level test that no node's props accept `class`, `className`, `style`, or an arbitrary string
  where a role is meant, and `tsc --noEmit` under `pnpm lint` is the pass that checks it. See
  [ui design](./ui-design.md) § The closed kit;
- Node-core tests cover data roots, TLS, auth, pairing, idempotency, migrations, backups, audit,
  worktrees, process/filesystem guards, routes, and WebSocket behavior;
- plugin tests cover schemas, providers, route behavior, reconciliation, and client models using
  package-local fixtures. Every plugin's `vitest.config.ts` is one line re-exporting
  `plugins/vitest.shared.ts` (node environment, `src/**/*.test.ts`, git config neutralized), and the
  testkit resolves a plugin's migration chain from its id — `makeTestPluginDb('github')` and
  `makeTestNodeContext({ plugin })` find `plugins/<id>/migrations` themselves;
- architecture tests scan the package graph for forbidden imports, undeclared dependencies, cycles,
  shell-binding leakage, protocol impurity, non-contract plugin edges, and route files that cast a
  request body instead of parsing it;
- the documentation checker (`tools/arch/docPaths.test.ts`) runs with the architecture tests and
  reads `docs/` rather than the code. A repo-rooted path in backticks has to resolve, and so does
  every relative link between two docs. It skips a path with no file extension, because a directory
  moves for reasons that are not rot; it skipped `docs/reviews/` while that folder existed, because a
  review is dated evidence and editing one to make a path resolve would falsify it (the reviews were
  retired to git history on 2026-08-28 once every finding had an owner); and it skips a path whose own line says
  the file is gone or not yet arrived, which is how the design and phase files already wrote them
  ("deleted and `schedules.ts` added", "moved to …", "(new; exact placement may change)", "in git
  history").
  A path that names a live file and a line that admits a dead one both pass; a stale citation does
  not;
- loadability tests EXECUTE the two rules that keep the workspace bootable, because a rule about
  whether something loads is honestly checked only by loading it:
  `packages/plugin-api/src/entrypoints.test.ts` imports every node-safe facade entrypoint in a
  node-environment vitest worker (the same shape a plugin's own suite runs in), and
  `apps/node/test/integration/mainBarrelLoad.test.ts` imports every plugin main barrel in a plain Node
  child. The arch suite's text checks stay as a fast, precise first line, but they are no longer the
  only line — and neither owns a file allowlist any more;
- the platform-seam contract suite is one checker run from both ends: `client-core/platform/contract.ts`
  states what a live capability group looks like, `platform/contract.test.ts` drives it against a mock
  host, and the shell's own suite drives it against the real object the shell installs
  (`apps/desktop/src/shell/bridge.test.ts`, under stub Tauri bindings). The seam's groups are
  nullable, so this is what turns "the host renamed a key" from a silently missing affordance into a
  failing test;
- desktop integration tests cover broker, fleet, persistence, plugin activation, and native seams;
- the desktop boot test and the Rust unit suite cover the shell (below); what needs a real window is
  on the smoke checklist.

## The desktop boot test

`apps/desktop/test/boot.test.ts` is the shell's `mainBarrelLoad` analogue: it catches "the shell
cannot load its world". It runs the staged helper under the bundled Node against a fresh data root,
which spawns the real `service.js` over the service protocol, then asks the helper the first two
questions the renderer asks: which nodes are there, and can a `/v2` request reach one. A 200 from
`/v2/node` means the pinned TLS connection came up and the device token authenticated, so one
assertion covers the custody stack end to end. Two more check the gate: a socket without the secret
is refused, and a plain HTTP request gets 426.

The Rust unit tests in `apps/desktop/src-tauri/src/` cover what a headless run cannot reach through
the helper: the renderer CSP and the dev-only widening a packaged build must not carry, the traversal
guard, the highlighter worker's separate policy, the refusal to answer a node route with the shell's
own HTML, the handshake and ready-line parsing, the data key's shape and file fallback, the plugin
scheme's hash grammar and frame CSP, the webview URL policies and the key grammar that picks between
them, the navigation-history bookkeeping, the capability file's webview scoping, and the three
packaging properties in `tauri.conf.json`. `.github/workflows/build-desktop.yml` runs both halves
before the bundler pass, so a broken boot path fails in seconds rather than minutes.

What no headless run reaches is compositing: a child webview positioned over a window needs a window.
That is what items 4 and 5 of the smoke checklist are for.

## The browser smoke test

`plugins/browser/src/server/driver.smoke.test.ts` runs an agent's loop against a real Chrome — load a
loopback page, snapshot it, fill a field by its ref, click a button by its ref, and read back the
console line the page logged with the value it saw. Opt-in through
`pnpm --filter @acorn/plugin-browser test:smoke`, because launching a browser is not something every
`pnpm test` should pay for. On a machine with no Chrome it takes the other branch and asserts the
tools reported why.

## The smoke checklist

Deliberately manual — it replaced the Playwright specs, whose harness left the repo with the Electron
shell. Run it per release. Its first pass is still owed, on a machine that never had the Electron
build, and nothing ships to a person until it passes (docs/shell.md § Signing gates and the updater).

1. Install and launch; the window appears and the local node reaches online.
2. Pair a second node by code; fingerprint words match.
3. Open a terminal; a TUI renders and survives resize.
4. Open a preview pane against a task dev server through the tunnel. Navigate, go back, and cover it
   with an overlay; the child webview hides rather than floating above it.
5. Open a loaded plugin pane; it renders, and a network call from its frame fails.
6. Open a loaded plugin's webview surface; a link to a host its manifest does not name is refused.
7. Trigger the quit flow with an active agent; the concern prompt appears; quit drains cleanly.
8. Kill the node process five times; the recovery screen appears on the sixth.
9. Install a data-only harness plugin against an agent CLI on the machine; the trust prompt names the
   command under `Enforced`, and after approving it the agent appears in the Agent Center and completes
   a turn. Nothing automated can cover this one: the suites can prove the descriptor reaches the driver
   registry, and only a real CLI can prove the transcript.
10. Build the reference node provider into the running node's data root
    (`pnpm --filter @acorn/node build:plugin nodes-file`, with `ACORN_NODES_FILE` set), write one
    node into that file, and from Settings → Nodes adopt it, run a task on it, then create and destroy
    one. Same reason as the item above: the route, provider and merge halves each have automated
    coverage and the rendered surface has none ([plugins.md](./plugins.md) § Node providers).

The next six items came from the user-extensions landing review (2026-08-15; they lived in a
`live-qa` file under `docs/future` until 2026-08-28). Plugin suites run in a node environment with no Solid transform, so the
chrome the extension work added has never been seen rendering by a test. Each names the behaviour to
see, not the code to read:

11. Right-click a surface with a plugin-declared context menu row; the menu appears at the pointer
    and clamps to the viewport instead of overflowing at a screen edge.
12. A plugin's declared `topbar` slot item renders at the topbar's right end, beside the node chip and
    the bell, at a size that does not distort the bar.
13. A contribution from plugin B renders inside plugin A's declared `pane.footer` point under a pane,
    with sensible spacing, overflow, and empty state.
14. Force a render throw in a plugin's `coreSlot` replacement; the surface falls back to core's own
    implementation rather than going blank.
15. Select a plugin-contributed theme; the terminal and Monaco pick up the right light or dark
    self-description. Disable the plugin; the fallback to Light or Dark happens without the stored
    preference being rewritten.
16. Edit a dev-mode plugin's entry file; the swap lands without a restart or a trust prompt. Edit a
    non-entry module; the one-module-deep limit surfaces as the restart hint, not silence.

The next two are the remote tree's, from layout phase 3 (2026-08-29). The suites cover the wire, the
renderer, the worker lifecycle and the two render paths producing identical DOM; what nothing
automated covers is a real worker started from a real bundle over the shell's own scheme.

17. Install a plugin declaring `contributions.remote` with `target: 'agentToolRenderer'`, accept its
    trust prompt, and run an agent turn that makes a matching tool call. The card draws from the
    plugin's worker and is indistinguishable from a compiled one: same spacing, same disclosure
    behaviour, same style pack. Reject the bundle instead and the built-in card draws.
18. Break that bundle so it throws on mount. The card shows the labelled placeholder, a row appears on
    the plugin's page, and the transcript around it keeps working — scrolling, selection, every other
    card.

One known appearance bug is recorded here so it is decided rather than slipped into an unrelated
diff: `:root:not([data-theme="light"])` under `prefers-color-scheme: dark` has the same specificity as
a named theme block and sets `--is-dark: 1`, so with the OS in dark mode the light-palette themes
`solarized-light` and `catppuccin-latte` tell xterm and Monaco they are dark while rendering light.
The fix is two lines and changes shipped visual behaviour for users of those two themes; it belongs
in its own change with its own note.

The dashboards backlog keeps its own once-only verification pass in
[docs/future/dashboards/README.md](./future/dashboards/README.md) § 0, because its items gate that
folder's remaining work rather than a release.

A worktree cannot run the app (no `.env`, and 4317 is the live instance), so run the whole checklist
from the main checkout.

## Composition-root tests

Tests that require populated plugin registries belong under `apps/node/test/integration` or the
desktop integration tree. Route protection must be tested through the real `createApp()` factory,
not by mounting middleware only in the test. Standalone parity tests ensure `dev:node` wires the same
pure-Node feature capabilities as the supervised Node.

## Testkit

`@acorn/node-core`'s testkit (`packages/node-core/src/testkit/`) used to be three files sitting under
`server/routes/`, because that is where a test-only SQLite factory was first needed. None of the three
were routes, and eleven packages ended up importing test scaffolding through a path that reads like
production surface. The directory move made the import path say what it is: every
`@acorn/node-core/testkit/...` import is test scaffolding by construction, and the arch suite fails a
production file that reaches one (docs/architecture-overview.md § Package boundaries). See
[plugins.md § What is published, and what acorn promises about it](./plugins.md) for why
`makeTestNodeContext` and `makeTestRequestContext` build a real host context rather than a mock.

`testEnv()` builds the `c.env` bindings a route test needs. `testSecretEnv()` and
`TEST_ENCRYPTION_KEY` mint the raw session key and the `SecretService` binding it seals together, as a
pair, because a test that sets only one of them compiles and then fails at the first credential read;
every test in the repo uses the same 64-hex key so a test can seal a credential with the same key the
`Env` it built is using.

`workspacePluginMigrations()` and `makeTestPluginDb()` resolve a workspace plugin's Drizzle migration
chain from its id, as `<checkout>/plugins/<id>/migrations`. They replaced about twenty call sites that
spelled out a path the id already implies, and the eight per-plugin `migrations.ts` modules that used
to do the same job. This only works from a source checkout, so a plugin developed outside this
checkout passes its migrations folder explicitly. The `plugins/<id>/` segment is spelled out rather
than found by walking up from the caller, so it can never resolve to core's own migration chain at
`packages/node-core/migrations`, which a bare ancestor walk would find first.

## Reliability

The suite launches Git, PTYs, Docker probes, provider fakes, and Node children. A full run is
resource-sensitive; verify a failing package in isolation before changing production timeouts. Do
not weaken runtime limits to accommodate a saturated test runner.

### Known pre-existing failures

Verified on a clean tree. If you see exactly these and nothing else, your change is not the cause:

- One live-PTY `posix_spawnp` failure in `agentSend` tests, a native-module ABI artefact.
  `pnpm rebuild:node` fixes the ABI class of failure; this one survives it.
- `plugins/http/src/server/send.test.ts` fails one case comparing a temporary worktree path, a
  macOS `/var` against `/private/var` artefact of the test's own fixture.
- `tools/arch`'s `docPaths` test reports broken citations in `docs/future/layout/`, which is an
  untracked design folder in progress. Check `git status` before reading that one as your own.

Also worth knowing before you read a red gate as your own: the root `lint` script is
`oxlint && turbo run lint`, so an oxlint failure means `tsc --noEmit` never ran at all. Check
which half failed before assuming the types are fine — or run `pnpm lint:types` on its own.

## Non-vacuity

Tests that assert source shape or route mounting must fail when the behavior is removed. Boundary and
parity tests include explicit graph/literal checks, while source-text tests strip comments before
matching implementation calls.

The snapshot-backed lists are the case that needs saying out loud, because a file you can regenerate looks
like one you can launder a regression past. `packages/plugin-api/src/surface.snapshot.txt` and the four
plugin golden lists (docs/plugins.md § The golden lists) are all asserted with exact equality against a
committed file, never a subset — a contribution that silently VANISHES has to fail as loudly as one that
appears — and each carries a hand-written floor beside it, because an exact match against an empty snapshot
would otherwise pass. Regeneration is deliberate, behind an env flag, and the diff is the review surface.

The facade snapshot goes one step further, because its file is a published contract rather than an internal
list: its first line records the `PLUGIN_API_MAJOR` it was written under, and `UPDATE_SURFACE=1` REFUSES to
write a snapshot that has lost a name while that major is unchanged. Adding is free; removing has to move
the number, which every plugin package's `apiVersion` range is checked against. It is the one regeneration
in the repo that can say no.

Two more regenerations joined it since: `UPDATE_PLUGIN_SCHEMA=1` rewrites the manifest JSON Schema from
the Zod contract (`packages/plugin-types/src/pluginSchema.test.ts`), and the same file's assertion is what
keeps the published schema and the contract one source of truth.
