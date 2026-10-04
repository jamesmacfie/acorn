# Security model

This page is the map of acorn's security model: the trust boundaries, what's out of scope, and which
page owns each control. Read it before you change anything that crosses a boundary.

acorn is single-owner software. A paired device has full owner authority for its Node. So the controls
protect the transport, credential custody, process boundaries, repository data, and untrusted provider
and preview content, rather than implementing multi-user roles.

Dashboard named actions send an action ID and full source reference. The Node checks scope, account
authority, current eligibility, and confined route ownership before dispatch. The host confirms write
and execute risk before sending anything, and a device-scoped idempotency key replays a completed
press. [Plugin routes](./security/plugin-secrets-and-routes.md) owns the dispatch boundary.
Board moves use the same `act` gate with a source field, expected value, and target. The Node
rechecks the registered source, account, field declaration, live value, target set, and plugin-owned
route. A device principal and host confirmation are required before dispatch. One move intent keeps its device-scoped
idempotency key across retries; a changed intent gets a new key. Plugin frames do not receive this
capability.

Datasets store copies of provider and workflow data at rest in core SQLite. Definition, version,
correction, and deletion routes require a device principal and are absent from plugin frame
bridges. Capture schedules also require device consent. Dataset sources enforce workspace and
optional project scope; task-scoped workflow and agent writes derive that scope from the task.
Deleting a workspace removes its datasets. Row and byte caps plus retention bound local storage.

## Trust boundaries

- **The renderer** runs UI code and third-party preview content. It holds no device token,
  certificate, database handle, process object, or direct network access.
- **The desktop shell and its helper** hold the native host, the broker, certificate pins, device
  tokens, window policy, and the preview webview host.
- **The Node** owns the authoritative data and the execution environment. It runs developer tools on
  purpose. A compromised Node can compromise its own host, but its replies and plugin offers stay
  untrusted input to a connecting client.
- **A Node child** is a task-scoped internal caller. It gets an allowlisted environment and a scoped
  token, and the Node checks its routes and task identity.
- **The terminal client** collapses the shell and helper into one process. UI code and the broker share
  a realm, so what the desktop holds as a process boundary this holds as a module boundary. The device
  token lives in the broker's module, the plugin cache and acknowledgements in one custody module, and
  an architecture rule refuses an import of either from any `apps/tui` module that draws a cell. A
  loaded plugin still gets a worker thread of its own under `--permission`.

acorn doesn't defend a Node host against root, other users, or a compromised Node account, and doesn't
sandbox first-party compiled plugin code. A client still treats a paired Node as an untrusted source of
replies, events, content, and plugin offers until an owner authorizes code.

The shell's Rust dependency patch and remaining upstream advisories are in
[Rust dependency security](./shell/packaging.md#rust-dependency-security). The dated review of October 1, 2026
is [review-2026-10-01.md](./security/review-2026-10-01.md).

## Pages

<a id="transport-and-auth"></a>

[Transport and auth](./security/transport-and-auth.md) covers TLS and pins, broker limits, the
`requireUser`, `requireDevice`, and provider-access gates, the mount coverage test, task scope, and
the WebSocket hub.

<a id="credential-handling"></a>

[Credential handling](./security/credentials.md) covers encrypted provider credentials,
`SecretService.use`, child environments, harness generation, and internal token scopes.

<a id="process-path-and-configuration-controls"></a>

[Process, path, and configuration controls](./security/process-and-paths.md) covers `resolveInRoot`,
the process broker, config trust, workflow authority, Docker, and force push.

<a id="the-control-plane-and-the-inversion-it-costs"></a>

[The control plane](./security/control-plane.md) covers what enrollment and node providers cost, and
what bounds it.

<a id="third-party-plugin-bundles"></a>
<a id="installing-from-a-folder"></a>
<a id="the-dev-grant"></a>
<a id="node-half-plugin-security"></a>
<a id="rung-1--permission-shaped-context-phase-1-shipped-with-the-loader"></a>
<a id="the-same-rule-for-what-a-plugin-can-reach-into"></a>

[Plugin security](./security/node-plugin-security.md) owns the plugin threat model, the containment ladder, and the
summary table. Its topic pages cover [client bundle trust](./security/plugin-bundles.md),
[installing plugins](./security/plugin-install.md), [the client sandbox](./security/plugin-client-sandbox.md),
[the node realm](./security/plugin-node-realm.md),
[secrets, routes, and agent tools](./security/plugin-secrets-and-routes.md), and
[storage and supply chain](./security/plugin-storage-and-supply-chain.md).

<a id="the-renderers-policy-and-its-dangerous-sinks"></a>
<a id="untrusted-provider-data"></a>

[The renderer and untrusted content](./security/renderer.md) covers the CSP, the provider HTML and
markdown sinks, provider payload projections, and AI authoring input.

<a id="host-owned-webviews-and-browser-automation"></a>

[Host-owned webviews and browser automation](./security/webviews.md) covers child webviews, the
preview pane's remote refusal, and agent browser tools.

<a id="filesystem-and-backup"></a>
<a id="audit"></a>
<a id="the-vocabulary-is-closed-and-a-plugin-can-add-to-it"></a>

[Audit](./security/audit.md) covers the audit trail, plugin audit verbs, why secret use isn't
recorded, and on-disk permissions and backups.
