# Plugin security

This page owns acorn's security model for plugin code: who the adversaries are, what a plugin could
reach, and the containment that stops it. Read it before you widen anything a plugin can touch. It's
part of the [security model](../security.md), and the topic pages below hold the detail.

A loaded plugin has two halves, and each has its own boundary. The client half is a bundle the Node
distributes to every paired device, and each device decides whether to run those exact bytes. The
node half runs on the Node in a permission-scoped worker realm. First-party compiled plugins are part
of the binary and aren't sandboxed.

## Topic pages

<a id="node-half-plugin-security"></a>
<a id="the-broadcast-namespace"></a>
<a id="rung-0--the-client-sandbox-shipped"></a>
<a id="rung-1--permission-shaped-context-phase-1-shipped-with-the-loader"></a>
<a id="telemetry-sinks"></a>
<a id="rung-2--isolated-node-realm-shipped"></a>
<a id="rung-3--os-level-sandboxing-the-last-door"></a>
<a id="secrets-narrow-use-scoped-access"></a>
<a id="tokens-routes-and-agents"></a>
<a id="storage"></a>
<a id="supply-chain"></a>
<a id="resource-abuse"></a>
<a id="design-rules-keep-the-boundary-intact"></a>

| Page | What it covers |
| --- | --- |
| [Third-party plugin bundles](./plugin-bundles.md) | Hash-bound consent for client bundles, custody on the desktop and terminal, and the threats it closes |
| [Installing plugins](./plugin-install.md) | The install route, agent requests, folder installs, and development mode |
| [The client sandbox](./plugin-client-sandbox.md) | Rung 0: the iframe, the tree worker, the terminal worker, and what stays refused |
| [The node realm](./plugin-node-realm.md) | Rungs 1 to 3: the permission-shaped context, the isolated worker, and the OS boundary still to build |
| [Secrets, routes, and agent tools](./plugin-secrets-and-routes.md) | How a plugin borrows a credential, and what task tokens and agent tools may reach |
| [Storage and supply chain](./plugin-storage-and-supply-chain.md) | Plugin SQLite policy, install integrity, and the design rules that keep the boundary intact |

## Threat model

Adversaries, most likely first, based on how extension ecosystems get attacked:

1. **A malicious update to a trusted plugin**, from a compromised maintainer account or repository.
   The install prompt was accepted long ago, and the update is the attack.
2. **A plugin malicious from the start**, dressed as something useful, such as a typosquat or a useful
   tool with a hostile payload.
3. **A sloppy plugin** with no hostile intent but over-broad access and bugs: secrets logged, paths
   traversed, or injectable route handlers.
4. **A compromised paired Node** pushing hostile client bundles. Hash-bound trust, per-device consent,
   and the client sandbox answer it.

Assets on a machine running a Node:

- **The data root**: `core.sqlite`, every plugin's SQLite file, the blob cache, and worktrees. The
  `projects` table is the most sensitive for a plugin to reach. It holds the shell commands the Node
  runs, such as `setup_script` and `db_url_script`, and the local path of every mapped codebase.
- **Provider secrets**, encrypted at rest and decrypted in the Node's memory when used.
- **The user's account**: `~/.ssh`, `~/.aws`, browser profiles, anything the user can read, and the
  ability to spawn processes.
- **The fleet**: a plugin's routes and broadcasts reach every device paired with the Node.
- **Agents**: plugin-contributed tools run inside agent sessions that read untrusted content.

The node realm can't reach these directly. It reaches only what its RPC context and launch grants
name. The loader tests try to open `core.sqlite` and another plugin's database through both an ESM
import and `process.getBuiltinModule`, and both fail before `DatabaseSync` is obtained.

## The containment ladder

Each rung is additive. Rungs 0 to 2 ship, and rung 3 is the OS boundary still to build.

| Rung | Boundary | Page |
| --- | --- | --- |
| 0 | The client half runs in a sandboxed iframe, a DOM-less worker, or a terminal worker thread | [Client sandbox](./plugin-client-sandbox.md) |
| 1 | The node half's context holds only what its manifest declared | [Node realm](./plugin-node-realm.md#rung-1-permission-shaped-context) |
| 2 | The node half runs in its own worker under Node's permission model | [Node realm](./plugin-node-realm.md#rung-2-isolated-node-realm) |
| 3 | Per-platform OS confinement of a plugin process | [Node realm](./plugin-node-realm.md#rung-3-os-level-sandboxing) |

Rung 2 is a resource boundary, not an OS security claim. Node calls its permission model a seat belt
rather than a sandbox for hostile code, and a worker isn't crash isolation.

<a id="summary-table"></a>

## Summary

| Asset | A loaded plugin's exposure | Mitigation | Rung |
| --- | --- | --- | --- |
| User files such as `~/.ssh` | None, unless the owner accepts an environment-backed file grant | Exact-path `--permission` grants. Data-root paths refused | 2 |
| The Node environment | A credential-free base plus individually declared names | Scrubbed worker `env`. Each name is a high-risk trust line | 2 |
| Other plugins' SQLite and `core.sqlite` | Direct open refused | Exact database, WAL, and SHM grants. Direct `node:sqlite` refused | 2 |
| Provider secrets | Lent per owner-bound connection callback | Scoped RPC callback. A credential-injecting broker would remove plaintext from the realm | 1 and 2 |
| Process spawning | Refused unless `exec` is declared | `exec` maps to `--allow-child-process` | 2 |
| Native code | Refused | `--permission` blocks addons, never `--allow-addons` | 2 |
| Network egress | `fetch` to declared hostnames only. Raw network modules refused | The realm's allowlist, and an OS sandbox for an adversarial boundary | 2, then 3 |
| Webview hosts | Loads remote content the plugin chooses | A host allowlist enforced across redirects, no devtools driver, an isolated partition | Shell |
| Agent sessions | Tool contributions | Ask-every-time defaults, and `execute` denied until granted | 1 |
| Fleet devices | Routes and broadcasts | Verified principal, task-shaped mounts, device-only administration, content-free broadcasts | 1 and 2 |
| Backups | Secrets a plugin stores in its own tables survive the scrub | Secrets go through core storage. Scope by `projectId` | 1 |
| Project config scripts | Only through `core.projects.config()` when granted | A separate `projects:config` grant and config trust | 2 |
| Project folder paths | Only through `core.projects.checkouts()` when granted | Split `projects:read` and `:write`, named in the trust prompt | 2 |
| Every other owner's telemetry | A sink sees every record | Its own `telemetry` grant, drawn high, with scrubbed scalar attributes | 1 and 2 |
| Trust over time | A malicious update | No auto-update, a hash re-prompt, a permission diff, provenance | Bundles |
| An install on an agent's say-so | A prompt-injected agent asks for a hostile package | The tool can't install. The device does, and the owner decides in shell chrome | Install |
| A plugin in development mode | Bundle hashes load without individual review | The same realm, one `(plugin, node)` pair, badged, revocable, and audited | Install |
| The terminal's device token and consent files | Any process running as the user can read them | A `0700` directory and `0600` files, held to their modules by an architecture rule | Custody |
