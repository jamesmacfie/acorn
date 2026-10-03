# HTTP client

The HTTP plugin is a request workspace you drive, in the style of Bruno. Requests and variables live
on the Node, encrypted where their values are sensitive. Read this page for the data model, how a send
works, the workflow step, and the topic page for the client. The plugin is in `plugins/http/`.

It's a loaded plugin. Its Node half serves `/v1/p/http` through the portable fetch carrier. Its client
half is one bundle drawing three host-drawn trees, and its rail entry is a manifest descriptor the host
renders ([http has moved](./loaded-plugin-migration.md#http-has-moved-and-the-storage-path-is-proven)).

## Data model

Requests can be project-filed or ad hoc. Variables can be plain, secret, or command-backed. Saved
requests and variables are stored in `plugins/http.sqlite`; unsaved task-pane edits remain drafts.
Secret values are encrypted with `SESSION_ENC_KEY` and are never returned as plaintext in list or read
responses. That filename is bound from the plugin's manifest id, so the id can never change, and the
DDL chain travels inside the installed package rather than with the app.

A request carries two task ids with different meanings once it is sent. `taskId` says where the
request is filed: null for a project-level request, set for an ad-hoc one. `executionTaskId` says
which task's worktree supplies builtins and runs command variables. A repo-saved request opened in a
task pane keeps its filing scope but executes in that task, so the stored `taskId` never doubles as
execution context.

An empty field is stored empty rather than sealed. The secret service treats an empty plaintext as
"no usable credential" and refuses it, so sealing `""` produced rows that saved and then failed to
read, and a GET with no body is the default shape of a new request. Rows written by the versions that
did seal it stay unreadable, because nothing distinguishes a sealed empty string from a value this
node cannot decrypt.

The plugin migrates older plaintext fields at Node initialization and fails closed when the encryption
key is unavailable. A command variable stores its command metadata, not its generated secret value.

## Sending

The Node resolves interpolation once, validates the resulting URL and scheme and the headers, then
sends with `fetch` under its own bounded time and response-size limits (`plugins/http/src/server/send.ts`).
One 30-second deadline covers variable resolution, fetch, and response reads. A response body over
5 MiB is capped while streaming; a completed body of exactly 5 MiB is not marked truncated.

Selection changes, a replacement send, and retirement of the invoking region cancel through the
SDK's API signal, host broker, portable Request, and isolated worker. The same signal retires all
owned command-variable processes through `core.proc` and closes a held response reader once.
Noncancelable task, project, database, and secret reads check retirement before admitting more work.
Cancellation cannot undo an HTTP mutation already transmitted. Navigation and recovery never replay
outbound sends.

URL, scheme, and header validation failures name the invalid field without quoting resolved content.
They remain `SendError` preparation failures, which the route returns as 422 and the workflow handler
persists as a failed step. Command-variable failures report their status, deadline, or output limit,
and withhold raw command stderr, spawn diagnostics, and thrown command messages.

For request URLs, request timelines, and transport diagnostics, the executor redacts resolved secret
variables and command outputs in raw, URI-component, form URL-encoded, and lowercase forms. These
cover common transport encodings and ASCII case normalization; they do not cover arbitrary
derived encodings. Complete HTTP response bodies and response headers remain deliberate response
data and can contain values returned by the chosen endpoint.

Variables resolve in one pass, lowest precedence first: task builtins, then project variables, then
per-request overrides. Only the names a request actually references get resolved, because a command
variable's value comes from running its shell command, and an override present at send time replaces
that variable before its command would otherwise run, not after, so an overridden command variable's
command never runs. Command variables execute concurrently through the host process broker; each
command gets 15 seconds and a 1 MiB per-stream output cap. This is the same mechanism the
Database pane uses for `dbUrlScript`, but with no repo-config trust gate: a command variable's command
is typed by the owner straight into the app's own database, not read from a committed
`.acorn/config.toml`, so there is no repo-authored code here to authorize.

Interpolation applies per field, never over a serialized request, so a variable's value cannot inject
delimiters and reshape the request it is filling. A response follows redirects through the fetch
client rather than a hand-rolled hop loop, because that client already strips the `Authorization`
header on a cross-origin redirect and a hand-rolled loop would have to reproduce it. The timeline
shows the final URL and whether a redirect happened, not each hop. It lists what was sent and what
came back under **Sent** and **Received**, and labels each header row by the header's own name.

There is no core HTTP service. Nothing central inspects an outbound request and there is no host
allowlist: this plugin declares an any-host fetch grant because the owner chooses each URL, and its
own validation is the whole control. That holds while every plugin is
first-party code in this repo, and it has to change before a third-party plugin can make outbound
requests, because at that point "each plugin validates its own" stops being a control. It is
described here rather than built, because a guard nobody can point at is worse than a documented
absence.

Every route in this router requires a `device` principal, send included, so internal agent and MCP
callers cannot use the HTTP pane as a general outbound or secret-reading oracle. Provider
integrations use their own allowlisted clients.

## The workflow step

`http:request` is this plugin's contribution to `workflows:step-kind`
([contributed step kinds](./workflows/step-kinds.md)). It sends through the same `send` path the
pane uses, so the post-interpolation scheme check, the 5 MB response cap, the project's variable
layers, and the command deadline all apply unchanged.

Its `describe` names the five fields the handler reads: `method`, `url`, `headers`, `bodyMode`, and
`body`. `headers` takes either a `[steps.with.headers]` table or one `Name: value` per line, which is
what the drawn textarea produces. `auth` is not a field. It is an object with a different shape per
mode, and a field that needs a component is not a field, so a step that authenticates writes `auth`
in the definition's JSON or puts the header in `headers`.

## Other outbound consumers in the Node

There is one more, and it is deliberately not built on anything shared: the plugin installer
(`packages/node-core/src/server/plugins/installer.ts`) fetches release metadata and a package archive when
an owner installs a plugin. It keeps its `fetch` usage inside its own module, with its own scheme guard
(https everywhere, http only on loopback, re-checked after redirects), a 32 MiB archive cap, and a
60-second timeout. Same posture as the send path above, and for the same reason: a general client
assembled from two call sites would be a control nobody owns. A credential-injecting fetch broker with
a host allowlist isn't built. If one is, converge both onto it.

## Pages

<a id="client"></a>
<a id="shared-model-and-region-leases"></a>
<a id="draft-recovery-and-acknowledgements"></a>

[The HTTP client surfaces](./http-client/client.md) covers the three surfaces, palette rows, agent
context capture, shared models, and draft recovery.
