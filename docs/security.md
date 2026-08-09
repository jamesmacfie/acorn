# Security model

acorn is single-owner software. A paired device has full owner authority for its Node. Security
controls therefore protect the transport, credential custody, process boundaries, repository data,
and untrusted provider/preview content rather than implementing multi-user roles.

## Trust boundaries

- Electron renderer: UI code and third-party preview content; no device token, certificate, database
  handle, process object, or direct network access.
- Electron main: native host, broker, certificate pins, device-token custody, window policy, and
  preview `WebContentsView` host.
- Node: authoritative data and execution environment. It is intentionally able to run developer
  tools, so a compromised Node account is outside the application threat model.
- Node child: task-scoped internal caller. It receives only an allowlisted environment and scoped
  token; its routes and task identity are checked by the Node.

The application does not defend against root/other-user access to the host, a compromised Node
account, or malicious first-party plugin code. Those are OS/deployment concerns.

## Transport and auth

- Nodes bind to `127.0.0.1` over TLS 1.3 and reject unexpected `Host` values.
- The certificate is self-signed, persisted in the Node data root, and pinned by fingerprint in the
  Electron broker. A changed fingerprint is a hard stop.
- Every protected HTTP route passes request-id, principal resolution, the auth gate, and then the
  idempotency middleware before reaching a router.
- `/v2/node` and `/v2/pair` are the only pre-auth routes. Device management, plugin toggles, audit,
  security, and backup are device-only.
- `/v2/events` authenticates the upgrade and rechecks device activity for long-lived streams.
- There is no cookie or ambient browser credential, so CSRF middleware is not part of the protocol.

## Credential handling

Provider credentials are encrypted at rest with `SESSION_ENC_KEY`, submitted write-only, and never
returned in API responses, client persistence, logs, events, or error envelopes. The GitHub token is
read only by the GitHub plugin's credential accessor. The HTTP client is device-principal-only and
does not expose encrypted request material to internal callers.

Child environments are built by the process broker. They do not inherit `SESSION_ENC_KEY`, GitHub
credentials, arbitrary `ACORN_*` values, or the parent process environment. They receive a task-scoped
internal token, the current data-root path, and the TLS trust material needed to call the Node.

The node-owner identity is opaque, explicit, and persisted at first boot. It is independent of
provider connections, and internal auth fails closed if it is unset. A task-scoped token cannot use
another task's task-addressed routes, terminal streams, preview tunnel, or worktree operations.
Provider-credential restrictions are route-specific; the current GitHub routes can be reached by an
authenticated internal principal and therefore can spend the active owner's GitHub credential.

## Process, path, and configuration controls

- Plugins use CoreServices for filesystem access and Git. The filesystem service applies one
  symlink-aware data-root/worktree confinement policy.
- Short-lived task work goes through the process broker, which uses explicit working directories,
  environment allowlists, process-group termination, bounded output, and production timeouts.
- Long-lived engines own their own children, under the same environment hygiene. The broker's model is
  "run a bounded command, capture its output, kill its group" — which does not fit a PTY, a JSON-RPC
  agent driver, a `docker logs -f` stream, a ripgrep scan or a pg client, all of which outlive a
  request and stream as they go. These are an ENUMERATED set, not an open door: the list of files
  permitted to import `node:child_process` is asserted in `tools/arch/boundaries.test.ts`, each entry
  with its reason, and adding one is a decision rather than a drift.

  This paragraph used to claim every child process went through the broker. Nineteen production
  modules did not, and the claim being both untrue and unenforceable was worse than not making it.
- Executable repository configuration (`.acorn/config.toml`, workflow files, and URL scripts) is
  hash-gated. The exact snapshot must be acknowledged before execution; a changed snapshot fails
  closed with `needs-trust`/`config-changed`.
- Docker matching configuration is declarative; Docker and run-target execution remains subject to
  the appropriate trust gate.
- External URLs opened through the OS pass a scheme allowlist. Preview navigation is limited to
  HTTP(S) URLs without userinfo.

## Third-party plugin bundles

A plugin installed on a Node is distributed by that Node: its client bundle travels the existing
broker pipe to every paired device. That makes a Node a source of executable code, so the bundle is
gated twice — once on content, once on consent.

**Trust binds to bytes, not to claims.** The hash a Node advertises in `/v2/core/plugins` is
untrusted input. Electron main fetches the bundle itself (the bytes never pass through the renderer),
hashes what arrived, and stores it content-addressed under that hash. A mismatch against the
advertised value is refused and reported, never re-keyed. Every acknowledgement therefore binds a
plugin id to a hash no one but this device computed.

**Consent is per device and per bundle.** First sight of a `(plugin, hash)` pair prompts, naming the
Node it came from and the permissions the manifest declared. An update arrives as a new hash and
prompts again, showing what the permissions gained. A rejection is remembered. Pairing a new machine
re-prompts, exactly as it re-pairs — the decision is about code this machine will run, so it is this
machine's to make. This mirrors repo-config trust one level out: that binds a project to the hash of
a config the Node will execute and is stored on the Node; this binds a plugin to the hash of a bundle
the device will execute and is stored beside the device token.

The threats this closes, and the ones it does not:

- **A compromised or hostile paired Node serving malicious JavaScript** — hash-verified bytes, a
  per-device acknowledgement that names the Node, and (phase 3) the sandboxed frame the bundle runs
  in. Nothing a Node pushes runs unprompted.
- **A Node lying in its listing** about hash, version or permissions — the hash is recomputed from the
  bytes. The permissions shown are the manifest as the Node's own loader read it; a Node that lies
  there also controls the bytes, so the containment rather than the disclosure is what bounds it.
- **Cache poisoning** — only main writes the cache, and content addressing means a poisoned entry
  cannot masquerade under a previously accepted hash.
- **Downgrade** — resolution prefers the highest version whose plugin-API major this client speaks. A
  Node offering an older bundle adds a candidate; it cannot evict a newer accepted one.
- **Not closed: the Node half.** A loaded plugin's node code runs in the Node's process, disclosed and
  acknowledged — the same trust class as an editor extension. Its declared `node` permissions shape
  the context it is handed; they are not enforced against a bundle that imports `node:fs` directly.
  Every surface that renders them says *declared*. `docs/third-party/node-security.md` holds the full
  model and the route to a hard boundary.

The only way a package reaches a Node's install directory is the owner-authenticated install route
(`POST /v2/core/plugins/install`, device principal only, audited). Nothing is distributed to a device
until a Node's owner has installed it, and nothing runs on a device until that device has separately
acknowledged the exact bundle bytes.

## Preview and browser automation

Preview uses a main-owned `WebContentsView` with an ephemeral session, no preload, isolated task
binding, navigation checks, denied permission requests, and browser chrome outside the guest page.
The remote preview tunnel accepts only declared task ports and authenticates its local loopback
request with a per-tunnel secret before forwarding it to the Node.

Agent browser tools use a CDP method allowlist. They do not expose arbitrary JavaScript evaluation.
Secret fields are filled through DOM primitives and are not injected into page scripts.

## Untrusted provider data

Rollbar occurrences and other provider payloads are parsed into bounded, allowlisted projections
before persistence or rendering. Raw payloads, request headers, cookies, bodies, IPs, and arbitrary
provider objects are discarded. Normalization failure rejects the item rather than widening the
surface automatically.

## Filesystem and backup

Data roots, credential files, TLS material, databases, WAL files, blobs, and worktrees are created
with restrictive permissions. A Node lock prevents two processes from opening one root. The app can
report disk-encryption status on macOS and surfaces the warning when it cannot verify full-disk
encryption.

Backups snapshot core and plugin SQLite files through SQLite's online-backup API. Device rows and
credential material are scrubbed, while blobs and worktrees are excluded because they are recoverable
and can dominate archive size. Restore is a documented manual operation into a fresh data root.

## Audit

The append-only core `audit` table retains security-relevant decisions for 90 days. Producers include
pairing-window changes, device pair/revoke, config-trust acknowledgement, secret create/replace/delete,
plugin toggles, and backup. The Settings → Security surface reads it. The trail is
not tamper-evident against someone who already controls the database file.
