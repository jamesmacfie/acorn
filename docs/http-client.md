# HTTP client

The HTTP plugin provides an owner-invoked, Bruno-style request workspace. Requests and variables are
Node-owned and encrypted where their values are sensitive.

It is a **loaded plugin** (`docs/plugins.md` § Two tiers), in neither compiled composition list. Its
node half serves `/v2/p/http` through the portable fetch carrier; its client half is one sandboxed frame
bundle drawing three surfaces, and its rail entry is a manifest descriptor the host renders. What moved
and what that cost is in `docs/third-party/README.md` § "http has moved".

## Data model

Requests can be project-filed or ad hoc. Variables can be plain, secret, or command-backed. Saved
requests and variables are stored in `plugins/http.sqlite`; unsaved task-pane edits remain drafts.
Secret values are encrypted with `SESSION_ENC_KEY` and are never returned as plaintext in list/read
responses. That filename is bound from the plugin's manifest id, so the id can never change, and the
DDL chain now travels inside the installed package rather than with the app.

A request carries two task ids with different meanings once it is sent. `taskId` says where the
request is filed: null for a project-level request, set for an ad-hoc one. `executionTaskId` says
which task's worktree supplies builtins and runs command variables. A repo-saved request opened in a
task pane keeps its filing scope but executes in that task, so the stored `taskId` never doubles as
execution context.

An empty field is stored empty rather than sealed, which is a fix worth knowing about: the secret
service treats an empty plaintext as "no usable credential" and refuses it, so sealing `""` produced
rows that saved and then failed to read, since a GET with no body is the default shape of a new
request. Rows written by the versions that did seal it stay unreadable, because nothing distinguishes
a sealed empty string from a value this node cannot decrypt.

The plugin migrates older plaintext fields at Node initialization and fails closed when the encryption
key is unavailable. A command variable stores its command metadata, not its generated secret value.

## Sending

The Node resolves interpolation once, validates the resulting URL and scheme and the headers, then
sends with `fetch` under its own bounded time and response-size limits (`plugins/http/src/server/send.ts`).
A request times out after 30 seconds and a response body over 5 MB is capped while streaming, so a
large or endless response cannot be buffered whole before the cap applies.

Variables resolve in one pass, lowest precedence first: task builtins, then project variables, then
per-request overrides. Only the names a request actually references get resolved, because a command
variable's value comes from running its shell command, and an override present at send time replaces
that variable before its command would otherwise run, not after, so an overridden command variable's
command never runs. Command variables execute through the process broker; each command gets 15
seconds and a 1 MiB output cap, and all of a request's command variables share one 30-second budget
so that several slow commands cannot add up to several times the wait. This is the same mechanism the
Database pane uses for `dbUrlScript`, but with no repo-config trust gate: a command variable's command
is typed by the owner straight into the app's own database, not read from a committed
`.acorn/config.toml`, so there is no repo-authored code here to authorize.

Interpolation applies per field, never over a serialized request, so a variable's value cannot inject
delimiters and reshape the request it is filling. A response follows redirects automatically rather
than through a hand-rolled hop loop, because the underlying fetch client already strips the
`Authorization` header on a cross-origin redirect and a hand-rolled loop would have to reproduce that
correctly itself; the timeline shows the final URL and whether a redirect happened rather than each hop.

There is no core HTTP service, and this paragraph used to say there was. Nothing central inspects an
outbound request and there is no host allowlist: the plugin's own validation is the whole control.
That is fine while every plugin is first-party code in this repo. It is exactly the thing that has to
change before a third-party plugin can make outbound requests, because at that point "each plugin
validates its own" stops being a control at all. Described here rather than built now, because a guard
nobody can point at is worse than a documented absence.

Every route in this router requires a `device` principal, not just send, so internal agent/MCP
callers cannot use the HTTP pane as a general outbound or secret-reading oracle. Provider integrations
use their own allowlisted clients.

## Other outbound consumers in the Node

There is one more, and it is deliberately not built on anything shared: the plugin installer
(`packages/node-core/src/main/pluginInstaller.ts`) fetches release metadata and a package archive when
an owner installs a plugin. It keeps its `fetch` usage inside its own module, with its own scheme guard
(https everywhere, http only on loopback, re-checked after redirects), a 32 MiB archive cap and a
60-second timeout. Same posture as the send path above, and for the same reason: a general client
assembled from two call sites would be a control nobody owns. The credential-injecting fetch broker
described in `docs/security.md` is the third, when it lands — and it is the one that
would be worth converging the other two onto, because it is the one with a host allowlist.

## Client

Three frame surfaces from one bundle, chosen by `bridge.context`:

| Surface | What it is |
| --- | --- |
| `http` (task pane) | The panel for a task: its ad-hoc requests above the project tree, with `{{worktree}}`/`{{branch}}`/`{{taskId}}` resolving against that task |
| `http-project` (project pane) | The same panel with no task, drawn beside the rail list at `/p/:projectId`, addressed by `/p/:projectId/x/http/requests/:requestId` |
| `http-variables` (settings) | Project variables, behind a project picker — variables are project-scoped and the settings modal only knows a workspace |

All three give tabs, request history, variables, auth helpers, curl import/export, response inspection,
and memory-only drafts. Node freshness/offline status follows the shared client model; a failed send
leaves the request text in the pane.

The **rail source** lists the project's saved requests and nothing more — the host draws the rows from
`/v2/p/http/rail-items`, and a click navigates to the project pane. It used to be the whole panel
rendered inside the rail; exploration moved into the frame beside it, deliberately, so the descriptor
vocabulary does not have to grow into a UI framework.

Two frame consequences visible in the UI: deleting a request or a variable takes two clicks rather than
raising a dialog (a frame has no `window.confirm`), and "Copy as curl" goes through the host
(`bridge.ui.copy`) because an unfocused document cannot write the clipboard.

Saved requests are attachable to an agent's context, served by the plugin's own
`/v2/p/http/context-options` and `/v2/p/http/context-capture` routes. The redaction runs on the NODE,
over rows whose ciphertext has just been opened: method, URL path, query KEYS, folder, auth mode, body
mode and header names survive; header values, the auth payload, the body, every variable and every
literal query value do not. A `{{VAR}}` reference in a URL is kept, because a reference is shape and its
resolved value never exists at capture time.

Legacy `http-draft:*` keys from releases that persisted unsaved drafts in `localStorage` are swept by the
SHELL at renderer activation (`client-core/persistence/legacyStorage.ts`), not by the plugin: a frame's
storage area is its own and could never have reached them.
