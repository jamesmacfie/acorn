# CLAUDE.md — acorn

A **local macOS agent workspace** with first-class GitHub pull-request review. A SolidJS SPA ships
inside the Electron app and loads from the bundled `app://acorn` origin. It talks to one or more
**nodes** — a Hono server (`@hono/node-server`) over HTTPS, each owning a data root — through a
**connection broker in Electron main**. A node is backed by a local SQLite read-model mirror of GitHub
data (better-sqlite3 + Drizzle) and an on-disk blob cache; IndexedDB persists the client query cache,
partitioned per node. V1's bearer-authenticated `/api/v1` automation listener is **gone**
(docs/vNext/plan.md § Approach) — headless automation returns later as a first-class vNext decision.

> **For architecture/domain detail, read [docs/architecture-overview.md](./docs/architecture-overview.md) first.**
> For the Cloudflare-Workers→Electron migration history and rationale, see
> [docs/electron.md](./docs/electron.md); current topic docs describe the shipped Electron runtime.
> vNext Phase 1 landed the protocol v2 / fleet spine; Phase 2 landed core services, the terminal scope-shed,
> scoped internal tokens, the plugin host and the database split; **Phase 3 is done** — the plugin→plugin
> baseline is ZERO, the shell imports no feature UI, and context sections are a per-plugin contribution point.
> Deliberate divergences and — importantly — what has NOT landed are recorded in
> [docs/vNext/phase1-notes.md](./docs/vNext/phase1-notes.md),
> [docs/vNext/phase2-notes.md](./docs/vNext/phase2-notes.md) and
> [docs/vNext/phase3-notes.md](./docs/vNext/phase3-notes.md). Read the Phase 3 notes before touching the
> client registries or assuming a disabled plugin is safe on the client — that half is unproven, and one
> security gap (a task-scoped agent can prune the Docker daemon) is open on purpose.

## Architecture (a client, and N nodes)

- The Electron main entry (`apps/desktop/src/app/main/electron.ts`) calls the native composition
  root (`app/main/bootstrap.ts`), which **spawns** and supervises the **built** Node artifact
  `out/main/service.js` — produced by `apps/node` (`src/service/index.ts`), never imported from
  desktop source. `spawn(process.execPath, [entry], { env: { ELECTRON_RUN_AS_NODE: '1' }, stdio:
  [..., 'ipc'] })`, not `utilityProcess.fork`: an ordinary Node child means the whole boot handshake is
  reachable from a plain-Node test (`apps/node/test/integration/serviceSpawn.test.ts`) and anything that
  can spawn a Node process can start a node.
- The Electron-free service root (`apps/node/src/service/runtime.ts`) builds the runtime bindings and
  starts the Hono app (`@acorn/node-core/server/index.ts`, a `createApp()` factory) under
  `@hono/node-server` over **HTTPS with `minVersion: 'TLSv1.3'`** on an **ephemeral port**. There is no
  pinned 4317 any more: the renderer has no browser origin on the node, and a pinned port makes two
  nodes on one machine impossible. `service.start` reports `{nodeId, endpoint, deviceToken,
  fingerprint, certPem}` back to main, which is how the client learns where the node bound.
  `ACORN_PORT` forces a port (tests, `dev:node`); otherwise the last bound port is remembered in
  `node.json` and falls back to ephemeral when taken.
- **The node serves no web assets.** `main/appScheme.ts` registers the `app://acorn` protocol over
  `dist/client` with a response-header CSP whose `connect-src 'self'` is possible *because* all node
  traffic is IPC through the broker — the renderer needs no network permission at all. Unmatched paths
  under `app://` serve `index.html` (client-side deep routes); on the node, an unmatched path is a plain
  404.
- **The plugin host** (`packages/node-core/src/server/plugin/`) is how a node plugin is assembled:
  `NodePlugin.init(ctx)` gets `{routes, capabilities, events, core, log}` and its own migrated SQLite
  handle, and `apps/node/src/server/plugins.ts` is the list — a plugin absent from it does not exist.
  Cross-plugin collaboration is a `CapabilityRegistry` (typed, late-bound, optional-by-default), owned by the
  service runtime rather than a module singleton. `contract/` is the only cross-plugin import surface, and as
  of Phase 3 the boundary test asserts **zero** non-contract plugin→plugin edges rather than a shrinking
  baseline. Both halves exist: `ClientPlugin`
  (`packages/client-core/src/registries/plugin.ts`) mirrors it over the nine client registries that have
  real contributions, with `apps/desktop/src/app/client/plugins.ts` as the list. Every plugin with a node
  part is through the host and
  `apps/node/src/server/routes.ts` is empty — the app names no product route module. `linear` and
  `rollbar` are not `NodePlugin`s because they own no tables and no routes of their own; they register
  through the integration-provider registry.
- **CoreServices** (`packages/node-core/src/main/core/`) is what a plugin consumes instead of
  deep-importing core: `fs` (one symlink-aware confinement), `git` (one seam, `GIT_TERMINAL_PROMPT=0`,
  `SSH_AUTH_SOCK` passthrough), `proc` (**the** process broker: allowlisted env, process-group kill,
  bounded capture), `secrets` (use-scoped, scrubs credentials out of anything thrown in scope), `tasks`
  (resolve a taskId now that plugins cannot query core's tables). No child process should call
  `spawn`/`execFile` directly any more.
- Routes are `/v2/core/*` (core-owned) and `/v2/p/<plugin>/*` (registry-projected, each contribution
  declaring its `plugin` id). Worktree/repo-config/task-lifecycle routes are **core's** as of Phase 2
  (`server/routes/worktree.ts`) — the terminal plugin serves `/v2/p/terminal/sessions*` and
  `/profiles` and nothing else. Every error is the envelope
  `{error:{code,message,requestId,retryable,details?}}` built in one place (`server/respond.ts`).
  `Idempotency-Key` is honoured on `/v2` mutations, keyed on the caller's `deviceId`.
- One authenticated WebSocket per node at **`/v2/events`** (`@acorn/protocol/ws.ts`), device bearer
  checked at the upgrade, with a per-connection `seq` so the client can detect loss. V1's flat
  `{channel,…}` frame vocabulary is deliberately kept.
- Process boundary: the node owns SQLite, HTTP/WebSocket listeners, PTYs/tmux,
  worktrees, Git/process execution, workflows, Docker/database services, reconciliation, and
  shutdown draining. Electron main owns `BrowserWindow`/`WebContentsView`, dialogs, `safeStorage`,
  navigation/keyboard policy, supervision, **and the connection broker** (`main/nodeBroker.ts`,
  `fleetStore.ts`, `deviceTokenStore.ts`, `nodePairing.ts`): endpoints, pinned certificates, device
  tokens and `fleet.json` all live there, never in the renderer.
  `@acorn/protocol/serviceProtocol.ts` carries versioned,
  Zod-validated lifecycle RPC; `@acorn/protocol/desktopCapabilities.ts` exposes narrow task-addressed
  native operations; `@acorn/protocol/broker.ts` carries the renderer↔main node contract. Serializable
  data crosses these boundaries, never DB handles, process objects, or `webContents` identifiers.
- Data: GitHub → local SQLite (via Drizzle, `better-sqlite3`) read-model mirror with ETag/TTL
  serve-then-revalidate; an on-disk dir caches immutable blob/patch bodies by SHA for all repos; IndexedDB
  persists the client query cache (one key per node, `acorn-cache:<nodeId>`). A node's data root holds
  `core.sqlite` (**not** V1's `acorn.sqlite`), `plugins/<name>.sqlite` (one per table-owning plugin —
  Phase 2, `main/pluginStorage.ts`; agents, changes, database, github, http, memory, terminal,
  workflows), `node.json` (nodeId + last port),
  `node.lock`, `tls/`, `blobs/`, `logs/` and `worktrees/`; `openDataRoot` mints the identity, takes an exclusive pidfile
  lock and **refuses a V1 root outright**. It lives at `apps/node/.acorn/` in development (gitignored)
  and Electron's `userData` root when packaged.
- Bindings: `packages/node-core/src/main/bindings.ts` builds the object routes read via `c.env` (DB,
  on-disk `BLOBS`, device/pairing/idempotency services, secret stores). It also protects the data root
  and persists the loopback internal token and active GitHub identity in mode-`0600` files. `Env` is an
  ordinary exported type there — it was an ambient `declare global`, which cannot work once each
  package compiles separately.
- Auth: **there is no session cookie and no login**. `session.ts`, `routes/auth.ts` and `csrf()` are
  deleted. A client authenticates with a **device token** (`acorn_dt_<uuid>_<base64url32>`, sha256 at
  rest, revocable, uniform-null on every failure) held by the broker in main + `safeStorage`, and the
  node holds no session state. `Principal` is `{kind:'device'|'internal', userId, deviceId?, scope?, taskId?}`; every
  paired device has full owner authority. A client gets its first token by **pairing**: `GET /v2/node`
  and `POST /v2/pair` are the only pre-auth routes; `POST /v2/core/pair/start`,
  `GET|DELETE /v2/core/devices*` and `DELETE /v2/core/pair` administer it below the gate. The bundled
  local node pairs without a code — the client spawned it, which is proof of owner intent. Internal
  child processes still authenticate with `x-acorn-internal` and cannot use the HTTP client as a secret
  oracle (`plugins/http` requires `kind === 'device'`). CSRF is gone deliberately, not by omission: there
  is no ambient credential for it to defend, and `hono/csrf` 403s any bodyless mutation.
- GitHub is an ordinary stored `integrations` row connected by **OAuth device flow**
  (`/v2/p/github/auth/device/{start,poll}`) — no redirect URI, no client secret, no auth
  `BrowserWindow`. `githubToken(c)` is the single read site, keyed on `ownerId(c)`.
  **Internal tokens are SCOPED** (Phase 2, `server/auth/internalTokens.ts`): a stateless HMAC token
  carrying `{scope, taskId?, sessionId?}`, where `INTERNAL_TOKEN` is the signing *key*, not the
  credential. `scope: 'service'` is the node calling its own HTTP surface over loopback and keeps full
  reach; `scope: 'task'` is everything injected into a child's env (PTYs, agent sessions, workflow
  steps, MCP servers) and is bound to one task. A task-scoped caller is **denied the owner's GitHub
  credential** (`canUseProviderCredential`) and is confined to its own task on the agent-tool surface —
  Phase 1's opposite posture is reversed. Tokens do not expire, deliberately: a tmux-reattached agent
  keeps the env of the boot that spawned it, so rotating the key is the revocation lever. Other
  providers' credential reads (linear, rollbar, database, model-providers) are **not** yet gated. See
  [docs/vNext/phase2-notes.md](./docs/vNext/phase2-notes.md).

## Repo map

pnpm workspace + Turborepo, **26 packages**. Every first-party package is consumed as TypeScript
**source** through an `exports` map (`"./*": "./src/*"`) — there is no per-package build, no `.d.ts`
emit and no project references. Consequences worth knowing before you touch a manifest:

- **Cross-package specifiers carry the real file extension**: `@acorn/protocol/api.ts`,
  `@acorn/node-core/server/db/index.ts`. Intra-package imports stay relative and extensionless.
  Do *not* try to make the extension optional with an array-form `exports` target — tsc accepts it
  and rolldown does not, giving a green typecheck and a red build.
- **Every package must declare every dependency its own source touches.** pnpm resolves relative to
  the source file's package, so a consumer cannot supply it. A `.tsx` file needs `solid-js` even
  though the JSX runtime is never imported by name.
- `@acorn/*` deps live in **`devDependencies`**: `externalizeDepsPlugin()` externalizes anything in
  `dependencies`, which would emit a runtime `import '@acorn/…/x.ts'` into the Electron bundle, and
  electron-builder's devDep pruning keeps the source out of the asar.

```text
apps/desktop/           @acorn/desktop      Electron main + preload + renderer + packaging
apps/node/              @acorn/node         the Electron-free service composition root + entries
packages/protocol/      @acorn/protocol     wire contracts (zod only; imports nothing first-party)
packages/node-core/     @acorn/node-core    server/ main/ mcp/ + Drizzle schema and migrations
packages/client-core/   @acorn/client-core  renderer runtime: shell, registries, queries, UI kit
plugins/<name>/         @acorn/plugin-<name>  20 features, each client/ server/ main/ shared/
tools/arch/             @acorn/arch-tests   the executable boundary rules
```

- `apps/desktop/src/app/` holds only Electron-side composition: `main/` (`electron.ts` entry,
  `bootstrap.ts` supervision, `serviceHost.ts`, `appScheme.ts`, `desktopCapabilities.ts`, `preload.ts`,
  `sessionKeyStore.ts`, and the broker set `nodeBroker.ts` / `nodeBrokerIpc.ts` / `nodeRequest.ts` /
  `nodePairing.ts` / `fleetStore.ts` / `deviceTokenStore.ts`) and `client/` (`index.tsx`, `App.tsx`,
  `CommandPalette.tsx`, `TaskView.tsx` and contribution activation). As of Phase 3 none of these imports a
  plugin's UI: the GitHub browse is a source contribution, the terminal drawer and the onboarding modal are
  slot contributions, and the palette's per-task rows come from a `paletteRows` registry.
- `apps/node/src/` is the service composition root: `service/` (runtime composition + the
  supervised-child entry), `server/` (`providers.ts`/`routes.ts` register plugin contributions;
  `standalone.ts` is the Electron-free entry behind `dev:node`), and `wiring/` — the service-owned glue
  that used to live in `app/main`. Three files left: `agentProfiles.ts` (core's, deliberately — it registers
  three separate profile plugins into a core registry consumed by terminal, workflows and agents),
  `agentToolsWiring.ts` (core's own six tools plus core's `issues` context section) and
  `configTrustWiring.ts`. It is named `wiring`, not `main`, because `main` now means Electron main.
  `managedWorkflowStep.ts`, `harnessWiring.ts`, `serverBridges.ts`, `managedAgentsWiring.ts`,
  `workflowWiring.ts`, `startupSecurity.ts` and — as of Phase 3 — `contextSectionsWiring.ts` are gone;
  each one's contents moved into the plugin whose engine or data it drove.
- `apps/node/test/integration/` — tests that need the composition root's registries populated
  (providers, routes, agent profiles). They live in the app because importing `app/*` is legal only
  from an app; doing it from a package is a boundary violation. The three suites left in
  `apps/desktop/test/integration/` are the client-side conformance ones.
- **`apps/desktop` must never import `apps/node` source** (`architecture.md`, boundary-tested). The
  desktop build embeds the built artifact: `apps/node` emits `dist/{service,mcp,standalone}.js` plus
  shared `chunks/`, and `electron.vite.config.ts`'s `stageNodeArtifact()` copies them into `out/main/`
  next to `index.js`, which is where `bootstrap.ts` spawns `service.js` and where `mcpRegister` points
  agent CLIs. `stageNodeArtifact()` can only detect an artifact that is *missing*, never one that is
  **stale**, so `dev` / `build` / `test:e2e` all run `build:service` first — turbo's `^build` edge is not
  in the chain when the package script is invoked directly, and a stale `service.js` once let the e2e
  suite pass against a service that no longer existed in the source tree.
- `packages/node-core/migrations/` — Drizzle migrations, co-located with `schema.ts`. The desktop
  build stages a copy into `apps/desktop/out/migrations` so the bundled service can find them.
- **`tools/arch/boundaries.test.ts` is the enforcement.** 14 rules over the package graph: nothing
  imports an app, no app→app, no relative import escapes its package, declared ⊇ used, protocol
  purity, the client/node split, the enumerated Electron surface, no package cycles, and **zero**
  non-contract plugin→plugin edges. Its scanner does not strip comments, so a comment containing an
  `import('@acorn/…')` expression becomes a phantom edge — describe a moved import in prose. It resolves bare `@acorn/*` specifiers *and* `vi.mock` paths, and it asserts
  up front that it can still see a non-trivial graph — the previous version matched only relative
  specifiers and would have passed vacuously after the split.
- Detail docs: [docs/frontend.md](./docs/frontend.md), [docs/diff-rendering.md](./docs/diff-rendering.md),
  [docs/ui-design.md](./docs/ui-design.md), [docs/electron.md](./docs/electron.md),
  [docs/api-reference.md](./docs/api-reference.md),
  [docs/authentication.md](./docs/authentication.md),
  [docs/github-integration.md](./docs/github-integration.md), [docs/data-layer.md](./docs/data-layer.md),
  [docs/caching.md](./docs/caching.md), [docs/docker.md](./docs/docker.md), and
  [docs/http-client.md](./docs/http-client.md).
- `docs/vNext/` — the target architecture. Read [docs/vNext/plan.md](./docs/vNext/plan.md) before
  starting phase work, and [docs/vNext/phase1-notes.md](./docs/vNext/phase1-notes.md) for where the
  shipped Phase 1 deliberately diverges from those designs.
- `docs/` — current architecture, feature, operations, and contributor documentation. **Some topic
  docs still describe the pre-split single-package layout; trust the tree over the prose.** Two
  known-stale vocabularies, left alone rather than swept because they mislead about names, not about
  behaviour: ~18 docs still say **"the utility service" / "utility process"** where the node is now an
  ordinary spawned Node child process, and a handful still say **"the Worker" / "D1" / "KV"** from the
  Cloudflare era. The transport facts (namespace, port, credential, origin) *were* swept — if you find
  a `/api/*` path, a port 4317 or a session cookie described as current anywhere, it is a bug.

## Key commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Build the node artifact + Electron main/preload/renderer, then `electron-vite preview`; the window loads `app://acorn` and the node binds an ephemeral HTTPS port |
| `pnpm dev:node` | Run one node standalone (no Electron) from `apps/node/src/server/standalone.ts` — ephemeral port unless `ACORN_PORT` is set, data root `ACORN_DATA_DIR` or `apps/node/.acorn`. Prints one JSON line (`nodeId`, `endpoint`, `fingerprint`, `certPem`, `deviceToken`). Needs Node-ABI better-sqlite3 (`pnpm rebuild:node`) and `SESSION_ENC_KEY` + `GITHUB_CLIENT_ID` |
| `pnpm --filter @acorn/desktop build` | Build `apps/node`'s `service.js`/`mcp.js`/`standalone.js`, then Electron main + preload + renderer, stage the node artifact, and enforce the renderer-size budget |
| `pnpm --filter @acorn/desktop dist` | Run the gated build, then `electron-builder --mac` to produce `.dmg`/`.zip` |
| `pnpm lint` | `tsc --noEmit` typecheck |
| `pnpm test` | Rebuild native modules for Node, then run `vitest` |
| `pnpm --filter @acorn/desktop test:e2e` | Rebuild the node artifact, build/rebuild for Electron, and run the Playwright suite (`desktop.smoke.spec.ts` S1–S8 + `twoNode.spec.ts`) |
| `pnpm db:generate` | Generate migrations and replay-check **every** chain — `scripts/db.mjs` discovers each package with a `drizzle.config.ts` (core plus one per table-owning plugin) |
| `pnpm db:check` | Replay every chain against a fresh SQLite database |
| `pnpm db:locate` | Print the absolute path to this worktree's local SQLite database |
| `pnpm db:migrate` | Apply migrations to the dev data root's DB (`apps/node/.acorn/core.sqlite`; override with `ACORN_DB_PATH`) |

## Conventions & gotchas

- **TypeScript strict; no `any`.** Match existing patterns and naming.
- **Process ownership:** new domain engines belong in the Electron-free service graph; Electron
  main is only for native UI/OS adapters and service supervision. Some service-owned modules retain
  the historical `core/main` or `plugins/*/main` paths (the `app/main/*Wiring.ts` set now lives in
  `apps/node/src/wiring/`). Classify them by
  dependency graph and runtime, not the folder label. Keep service↔main payloads serializable and
  task-addressed; use HTTP/WebSocket for renderer-facing product APIs.
- **Schema change workflow:** edit `packages/node-core/src/server/db/schema.ts` → `db:generate` →
  `db:migrate` (or just launch — `openDb` migrates on startup). After changing the bindings shape,
  update the exported `Env`/`RuntimeBindings` in `packages/node-core/src/main/bindings.ts`. (Drizzle quirk: a `NOT NULL` column on a
  populated table emits a table-rebuild migration whose `INSERT … SELECT` copy must be trimmed by
  hand — see [docs/local-development.md](./docs/local-development.md).)
- **Secrets** live in `apps/desktop/.env` (gitignored) in dev — never commit them. `SESSION_ENC_KEY`
  self-provisions via Electron `safeStorage` in packaged builds (`main/sessionKeyStore.ts`); an env
  key wins and is migrated into safeStorage, while an existing DB with neither key fails closed;
  it must be **exactly 64 hex chars** (`openssl rand -hex 32`) and
  `server/secretBox.ts` rejects anything else. Its name is now a misnomer — there is no session — but
  it is what encrypts integration tokens and HTTP-client fields at rest via
  `encryptSecret`/`decryptSecret`, so it outlived the cookie. `GITHUB_CLIENT_ID` is **required** to boot
  a node (the device flow needs it); it resolves from `apps/desktop/.env`, then the data-root `.env`,
  then the process environment, then build-time `MAIN_VITE_GITHUB_CLIENT_*` fallbacks used by the
  release workflow. `GITHUB_CLIENT_SECRET` is read *optionally* and **nothing consumes it** — the device
  flow exchanges on `client_id` alone. It is retained at the owner's explicit request; do not delete it.
  That removes V1's "the embedded client secret is recoverable from a distributed binary" caveat.
- **better-sqlite3 ABI:** `better-sqlite3`/`node-pty` are native — a compiled `.node` matches *one*
  ABI at a time (measured: Node 137, Electron 42 → 146). `pnpm dev` (Electron) needs the Electron
  ABI; `pnpm test` / `dev:node` / `db:migrate` (plain Node) need the Node ABI. Every package resolves
  to the SAME physical copy in the pnpm store, so the rebuild is a single **root** step that runs
  once before `turbo run test` — never per package, or one package rebuilds it while a sibling's
  tests are loading it. `pnpm test` self-heals (fast no-op when already correct). Afterwards run
  `pnpm run rebuild` (Electron ABI) before `pnpm dev`. `pnpm rebuild:node` switches back manually.
- **No OAuth callback to register.** GitHub connects by the device authorization grant, so the OAuth
  app needs **no** callback URL — the old `http://127.0.0.1:4317/auth/callback` registration is dead, and
  it could not have survived an ephemeral port anyway. The one setting the GitHub OAuth app does need
  is **"Enable Device Flow"**. See [docs/authentication.md](./docs/authentication.md).
- **Blob cache:** `BLOBS` is a local on-disk dir keyed by SHA (`patch:<sha>` / `filebody:<sha>`
  prefixes). The old Workers-KV-era `if (!repoRow.private)` public-only guard has been removed from
  the github plugin's `pullBlob.ts`/`prMirror.ts`; blobs are cached for all repos. See
  [docs/caching.md](./docs/caching.md).
- **Repo config trust:** executable `.acorn/config.toml` and workflow changes are hash-gated. Review
  and acknowledge the exact snapshot through `/v2/core/tasks/:id/config-trust`; the *authoring* surface
  for the same executable content is `PUT /v2/core/repos/path/config`, beside it in core; Docker matching config
  is declarative and is deliberately outside that executable-config gate.
- **Turbo caching is load-bearing and easy to get wrong.** Source-only packages have no `build`
  script, so `dependsOn: ["^build"]` resolves to nothing — hence the `topo` transit node, which is
  what makes a `node-core` edit invalidate its dependents' cached `lint`/`test`. It requires an
  **acyclic** package graph. `tsconfig.base.json` is in `globalDependencies` because otherwise
  editing the shared compiler options leaves all 26 lint tasks on a cache hit. A task that reads
  files it does not import (the boundary test) needs explicit `inputs` or it caches forever.
- **The suite is load-sensitive, and the split made it more so.** Many tests spawn real
  subprocesses — git worktrees, `bash -lc` login shells, PTYs — and 26 packages testing concurrently
  can saturate the machine until those exceed *production* timeouts (e.g. send.ts's 15s command
  cap). Symptom: a full cold `turbo run test --force` occasionally fails one package, usually
  `plugins/http` or `@acorn/node-core`, which then passes in isolation. Mitigations in place:
  `pnpm test` caps turbo concurrency at 6, and the worst offender carries an explicit `retry`. Do
  **not** "fix" a recurrence by loosening a production timeout to suit the runner — verify the
  package in isolation first, and only then treat it as real.
- **Before claiming done:** run `pnpm lint` (and `pnpm test` where relevant).
