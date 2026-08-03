# Testing

> **Removed.** The bearer-authenticated public automation API (`/api/v1`), its tokens,
> idempotency store and second listener were deleted in vNext Phase 0 — along with
> `oauth_accounts`, `api_tokens`, `api_idempotency` and `command_executions`. Its test suites went with
> it. See [vNext/plan.md](./vNext/plan.md).

The workspace uses Vitest for unit, route, integration, architecture and conformance tests, and
Playwright-Electron for the end-to-end suite. Run commands from the repository root unless noted.

| Command | Coverage |
| --- | --- |
| `pnpm lint` | Strict TypeScript (`tsc --noEmit`) across all 26 packages |
| `pnpm test` | Rebuild native modules for the Node ABI, then run the complete Vitest suite (turbo, concurrency capped at 6) |
| `pnpm build` | Build the node artifacts, Electron main, preload and renderer; enforce the 1.25 MB startup-script / 200 KB CSS budgets |
| `pnpm --filter @acorn/desktop test:e2e` | Rebuild the node artifact, build, rebuild native modules for the Electron ABI, then run the Playwright suite: **S1–S8** in `e2e/desktop.smoke.spec.ts` plus the two-node scenario in `e2e/twoNode.spec.ts` (9 tests, `workers: 1`) |
| `pnpm db:check` | Replay the full migration chain on a fresh database |
| `pnpm --filter @acorn/desktop exec electron scripts/smoke-browser.cjs` | Manual drivable-preview smoke against a running Electron app |

## Test layers

- Pure domain tests cover reducers, parsing, config layering, cache codecs, workflow validation,
  profile adapters, and state restoration.
- Route tests mount Hono routers with a seeded principal and fake bridge implementations. Use
  `testGate(principal)` (`node-core/server/routes/testAuth.ts`), which seeds `c.principal` exactly as
  `authMiddleware` would and then runs the **real** `requireUser`, so a test cannot drift from the
  seed → gate order `createApp()` enforces. Pass `null` for an unauthenticated request. They verify
  auth, body validation, the typed error envelope, and clean `bridge-unavailable` degradation without
  launching Electron.
- `tools/arch/boundaries.test.ts` resolves bare `@acorn/*` specifiers *and* `vi.mock` paths across the
  package graph: nothing imports an app, no app→app, no relative import escapes its package,
  declared ⊇ used, protocol purity, the client/node split, the enumerated Electron surface, no package
  cycles, and a shrinking plugin→plugin ledger. It asserts up front that it can still see a non-trivial
  graph, so it cannot pass vacuously.
- `@acorn/protocol/serviceProtocol.test.ts` covers concurrent bidirectional RPC, protocol-version
  mismatch, unavailable handlers, and peer-close cleanup. `apps/node/src/service/runtime.test.ts`
  exercises migration, reconciliation and shutdown without Electron or GitHub.
- `@acorn/node-core/server/integrations/conformance.test.ts` runs every registered provider through
  capability, codec, budget, formatting and secret-hygiene obligations.
- Startup/restore integration tests prove descriptor order, late registration, persistence arming and
  scoped eviction. The persisted-state and workflow registry conformance suites iterate every
  descriptor and enforce malformed-input tolerance, bounds, unique identity, handlers, and
  descriptor-owned validation.
- Workflow tests use the committed fake agent through the real argv/template path and cover gates,
  joins, fan-out, branching, cancellation, reconciliation, and tool ceilings.

### Transport and fleet (vNext Phase 1)

The transport is the part hardest to test honestly, so it is worth knowing which suite proves what.

- `apps/node/test/integration/serviceSpawn.test.ts` — the service as a **real, separately spawned
  process** on a temp data root, under plain Node with no Electron: the IPC boot handshake, the state
  sequence, a validated HTTPS request against the pin it just reported, and pairing / `Idempotency-Key`
  replay / revocation over the wire. What it cannot cover is the *packaged* path (Electron's binary
  under `ELECTRON_RUN_AS_NODE` loading the artifact out of `app.asar`) — that is the e2e suite's job.
- `apps/node/test/integration/pairing.test.ts` — the pairing surface over the assembled app: what the
  two pre-auth routes may leak (key-exact, not a subset match), that every pairing failure is
  byte-identical, the attempt budget, and that a bearer `DELETE` carrying no content-type at all still
  works (the regression guard on the `csrf()` removal).
- `packages/node-core/src/main/wsHub.test.ts` — a real `ws` client against a real `http.Server` with the
  hub attached: upgrade auth (bearer / internal / Host, and no fallback from a bad bearer), per-connection
  `seq`, replay-before-live ordering on attach, and **both** revocation paths kept genuinely separate —
  the immediate case fires `onRevoked` while leaving `isActive()` true, and the sweep case flips
  `isActive()` without firing `onRevoked`, so neither can be passing because of the other.
- `apps/desktop/src/app/main/nodeBroker.test.ts` — the real broker against a real HTTPS server using the
  node's own `ensureCert` output, so a change to the certificate's extensions turns this file red rather
  than production. Covers pinning (including a certificate signed by an unrelated key that *claims* the
  right fingerprint), reconnect on a `seq` gap, giving up on an unauthorized upgrade, and the
  distinction between the auth gate's `401 unauthenticated` (⇒ node revoked) and a route-level
  `401`/`403` about a third-party credential (⇒ leave the node alone).
- `packages/client-core/src/node/fleet.test.ts` — the per-node cache partition, including two nodes
  holding the same resource UUID, and `selectActiveNode`'s ordering invariant.

## End-to-end

`playwright.e2e.config.ts`: `testDir: './e2e'`, `workers: 1`, `fullyParallel: false`, 30 s default
timeout. The specs are typechecked by `pnpm lint` (`e2e` is in the desktop tsconfig's `include`).

**There is no login backdoor left.** `ACORN_E2E=1` now does exactly one thing — it makes
`main/electron.ts` take its data root from `ACORN_E2E_DATA_DIR` instead of the OS `userData` dir. The
old environment-gated `/auth/test-login` seam is deleted along with the rest of `routes/auth.ts`,
because there is no session to establish. The suite seeds through the **same bridge the renderer uses**:
`window.acorn.nodeFetch` / `nodeSend` in `page.evaluate`. Raw `fetch('/api/…')` from the page worked only
while the launch had established a session cookie on the node's own origin, and the window is on
`app://acorn` now — the CSP would refuse the connection even if a credential existed.

Each launch also gets its own Chromium profile (`--user-data-dir=<dataDir>/chromium`), keyed to the data
dir. The renderer's origin is the *constant* `app://acorn`, so its IndexedDB bucket is shared by every
launch that shares a userData dir; under the old http origin the random port gave each launch a fresh
bucket by accident, and without the flag one test's still-fresh cached task list rehydrates into the next
test's window.

`desktop.smoke.spec.ts`:

| | Covers |
| --- | --- |
| **S1** | Supervised boot of the shell, with **zero console errors** — which is the guard on the `app://` CSP, since a violation is reported as a console error and nothing else |
| **S2** | Durable task state restored across two launches of the same data root |
| **S3** | Opening a task from the rail |
| **S4** | Terminal echo over the authenticated WebSocket, driven through `nodeSend`/`onNodeFrame` (the bearer rides the upgrade headers, which a page cannot set) |
| **S5** | Quit tears down a live PTY child |
| **S6** | Find-in-files → copy path / double-click reveal in the editor, then save and read back |
| **S7** | Agent Center, task agent switching, the conversation, context chips and queued-turn controls (150 s) |
| **S8** | Hard reload of a deep route under `app://` — the protocol handler's `index.html` fallback, `base: '/'`, and that the CSP header is actually present (S1 catches a policy that is too tight; only this catches one that is missing) |

`twoNode.spec.ts` is plan.md's Phase 1 exit criterion: the app boots its bundled node, a **second** node
comes up from the built `standalone.js` artifact on its own temp data root and ephemeral port, the
renderer probes and pairs it through `window.acorn`, both connections reach `online`, and both nodes are
made to hold the **same** workspace and task UUID with different names — switching with the dev node
switcher swaps what the rail shows and switching back finds the first node's data intact.

It is Playwright rather than Vitest deliberately: turbo's `test` task has no `build` dependency, so a
Vitest test needing `apps/node/dist/standalone.js` would be flaky or permanently skipped, whereas
`test:e2e` builds first. It also has to run under **Electron's** Node (`ELECTRON_RUN_AS_NODE=1`), because
`test:e2e` rebuilds `better-sqlite3` for the Electron ABI and plain `node` could not open a database.

## Adding tests

Keep tests beside the code they characterize. Prefer a focused pure test when behavior can be isolated;
use route tests for transport and privilege boundaries. A new plugin registry or provider capability
should add a conformance assertion so later contributors inherit the rule automatically. When a source
import crosses an architectural layer, update the implementation to use a contribution or capability; do
not expand the boundary ledger as a convenience.

Two environment facts that regularly cost time:

- **Vitest cannot render components.** Tests are `*.test.ts` in the node environment with no Solid
  plugin, so a green suite proves nothing about UI. That is what the Playwright suite is for.
- **The ABI flips.** `pnpm test` builds `better-sqlite3`/`node-pty` for the Node ABI; run
  `pnpm run rebuild` (Electron ABI) before `pnpm dev` or `test:e2e`. Both `pnpm test` and `test:e2e`
  self-heal, so the failure mode is a slow first run rather than a confusing one.
- **The suite is load-sensitive.** Many tests spawn real subprocesses (git worktrees, login shells,
  PTYs), and 26 packages testing concurrently can push those past *production* timeouts. A package that
  fails under full-suite load and passes in isolation is that class — confirm in isolation before
  treating it as real, and never loosen a production timeout to suit the runner.
