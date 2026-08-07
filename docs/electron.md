# Electron runtime

Electron is acorn's native host. It does not own product data or feature engines. The Node service
is built separately and embedded into the desktop package; Electron starts it and brokers access to
it.

## Main process

`apps/desktop/src/app/main/electron.ts` creates the application window and registers the `app://acorn`
protocol. `bootstrap.ts` composes:

- service supervision and restart policy;
- the node connection broker;
- `safeStorage` and device-token custody;
- navigation, window creation, and external-URL policy;
- native folder dialogs and preview/browser capabilities;
- quit-time service shutdown and view cleanup.

The main process must not import plugin engines, database handles, or Node source. Domain behavior
belongs in the Electron-free service graph.

## Node child

The desktop starts the built artifact at `out/main/service.js` with:

```ts
spawn(process.execPath, [entry], {
  env: { ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
})
```

The Node sends a versioned service-protocol `start` response containing its `nodeId`, endpoint,
certificate fingerprint/PEM, and local device token. Electron adopts that record into the broker only
after the listener is ready. Startup failures fail closed; a crash after startup is retried with
bounded exponential backoff and eventually shows the recovery UI without creating a new data root.

The Node owns SQLite, migrations, HTTP/WebSocket listeners, PTYs, tmux, worktrees, Git, processes,
workflows, Docker, provider clients, reconciliation, and shutdown draining. `will-quit` asks it to
close the listener, dispose plugin engines, close SQLite, and release the data-root lock with a
30-second overall deadline.

## Renderer origin and protocol handler

The renderer loads from `app://acorn` and the Node serves no assets. `main/appScheme.ts` maps bundled
files from `dist/client`, returns the bundled `index.html` for client-side deep routes, and adds the
renderer Content-Security-Policy. The CSP uses `connect-src 'self'`; renderer code cannot make a
direct request to a Node.

The preload exposes a narrow, validated `window.acorn` surface. It carries broker request/response
bytes, stream frames/status, fleet operations, lifecycle actions, folder selection, and task-addressed
desktop capabilities. It never exposes raw `ipcRenderer`, a Node token, a certificate, a database
handle, a process object, or a `webContents` ID.

## Connection broker

`main/nodeBroker.ts` is Electron-free apart from its use by the main composition root. For each Node
it owns:

- endpoint and certificate fingerprint;
- a pinned `https.Agent` and device token;
- one authenticated WebSocket;
- request aborts, stream routing, reconnect backoff, and connection state.

The renderer calls `nodeFetch(nodeId, request)` and stream methods over preload IPC. The broker adds
the bearer, validates the pinned certificate, and returns serializable response bytes. Node states
are `online`, `degraded`, `offline`, `incompatible`, and `revoked`.

Both ends run a ping/pong watchdog. A sequence gap or watchdog failure makes the Node stale and causes
the client to reconnect/refetch. A mutation is never queued automatically while a Node is offline.

## Preview views

Preview is a main-owned `WebContentsView`, one kept-alive view per task. It uses a task-specific
ephemeral session, no preload, denied permission requests, HTTP(S)-only navigation, and an external
chrome layer rendered by the desktop. Main positions the native view over the renderer's pane host
and hides it while overlays cover the pane.

For a task whose dev server is served by another Node process, the broker creates an authenticated
loopback preview tunnel. The tunnel accepts only a declared task port and requires its per-tunnel
secret before forwarding bytes to the Node's tunnel endpoint. The tunnel is bounded by pane lifetime,
idle cleanup, connection limits, and request-head limits.

## Service protocol

`packages/protocol/src/serviceProtocol.ts` defines versioned lifecycle messages and
`desktopCapabilities.ts` defines narrow native calls. Both endpoints validate messages with Zod.
Calls are task-addressed and serializable. Pending calls reject on timeout or peer exit. Product
requests do not use this RPC; they use `/v2` over the broker.

## Native capability boundary

The service may request only the native operations represented by
`@acorn/protocol/desktopCapabilities.ts`. Preview/browser calls are validated in Electron main and
remain scoped to a task and binding. The service never receives a `BrowserWindow`, `WebContentsView`,
or Electron object.

## Build and packaging

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and shared chunks. Electron Vite stages the
service artifact and every core/plugin migration chain into `apps/desktop/out/`. The desktop build
must run the service build first; staging detects missing artifacts, not stale ones.

`better-sqlite3` and `node-pty` must be rebuilt for the ABI of the process that will load them. Plain
Node development uses the Node ABI; the packaged app uses the Electron ABI. `electron-builder` then
produces the macOS DMG/ZIP. The standalone Node is distributed separately as a tarball; it is not an
npm package.
