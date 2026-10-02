# HTTP client

The HTTP plugin provides an owner-invoked, Bruno-style request workspace. Requests and variables are
Node-owned and encrypted where their values are sensitive.

It is a loaded plugin (`docs/plugins.md` § Two tiers), in neither compiled composition list. Its node
half serves `/v1/p/http` through the portable fetch carrier. Its client half is one sandboxed frame
bundle drawing three surfaces, and its rail entry is a manifest descriptor the host renders. What
moved, and what that cost, is in `docs/loaded-plugin-migration.md` § "http has moved".

## Data model

Requests can be project-filed or ad hoc. Variables can be plain, secret, or command-backed. Saved
requests and variables are stored in `plugins/http.sqlite`; unsaved task-pane edits remain drafts.
Secret values are encrypted with `SESSION_ENC_KEY` and are never returned as plaintext in list/read
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
shows the final URL and whether a redirect happened, not each hop.

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
([workflows.md](./workflows.md) § Contributed step kinds). It sends through the same `send` path the
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
assembled from two call sites would be a control nobody owns. The credential-injecting fetch broker
described in `docs/security.md` is the third when it lands, and it is worth converging the other two
onto, because it is the one with a host allowlist.

## Client

Three frame surfaces from one bundle, chosen by `bridge.context`:

| Surface | What it is |
| --- | --- |
| `http` (task pane) | The panel for a task: its ad-hoc requests above the project tree, with `{{worktree}}`/`{{branch}}`/`{{taskId}}` resolving against that task |
| `http-project` (project pane) | The same panel with no task, drawn beside the rail list at `/p/:projectId`, addressed by `/p/:projectId/x/http/requests/:requestId` |
| `http-variables` (settings) | Project variables, behind a project picker. It is one node page under Features, **API requests**, not a tab on each project's page |

All three give tabs, request history, variables, auth helpers, curl import/export, response inspection,
and memory-only drafts. Node freshness/offline status follows the shared client model; a failed send
leaves the request text in the pane.

The rail source lists the project's saved requests and nothing more. The host draws the rows from
`/v1/p/http/rail-items`, and a click navigates to the project pane. Exploration lives in the panel
beside it, so the descriptor vocabulary does not have to grow into a UI framework.

### From the command palette

Three rows under an **API** group (`docs/command-palette-and-shortcuts.md`), all declared in the
manifest and all served by this plugin's own node half.

| Row | Kind | What it does |
| --- | --- | --- |
| Find a saved request | search, project-scoped | `/v1/p/http/palette/requests` answers the routed project's saved rows; picking one navigates to `http-project`, the same address the rail row has |
| New request | action | Delivers `new-request` to the `http` pane, where the panel starts a blank draft — the same thing the "+ Request" button does |
| Import a curl command | input, task-scoped | `/v1/p/http/palette/import-curl` parses the pasted command, saves it encrypted against the task, and opens the pane on it |

Two properties are the point of the pair, and both are structural rather than a filter applied
afterwards.

**The search cannot return a secret, because it never reads one.** The URL, the headers, the body, the
auth block and the variables are the five columns the node encrypts. The palette's query selects `id`,
`name`, `folder` and `method` and nothing else, so no ciphertext is opened anywhere on the path and a
row has no field a credential could occupy — not even the URL, which the rail beside it also leaves
out, since `?token=…` typed literally is an ordinary way to have saved a request. Rows are filtered by
owner *and* project in SQL, so another login's requests and another project's are never selected.
Contrast the agent-context capture, which does open the ciphertext and therefore carries a redaction
pass and an allowlist.

**The import never sends and never shells out.** `fromCurl` reads flags out of a token list produced by
`tokenizeShell`, which is a quote-and-escape reader and not a shell: no `child_process`, no `fetch`. A
`$(…)` or a backtick in a pasted command is stored as the literal text it is. The parsed request goes
through the same body schema and the same encryption a save from the pane does, and the route answers
only once the row is stored. Sending stays a separate act the reader takes in the panel with the
request in front of them.

All three surfaces are **trees**: the plugin's code runs in a worker and emits a tree of the host's own
components (`docs/plugins.md` § The tree contract). Four consequences are visible in the UI, and all
four are the same consequence — the plugin has no document of its own.

- Deleting a request or a variable takes two clicks rather than raising a dialog, and "Copy as curl"
  goes through the host (`bridge.ui.copy`).
- **Pasting a curl command into the URL bar expands it on commit, not on paste.** Press Enter or leave
  the field and the whole request fills in. A paste is a DOM event and there is no DOM to raise one in;
  the check runs where the committed text arrives instead.
- The Body and Auth mode selectors sit immediately below the request tab strip. `Tabs.actions` is a
  JSX-valued shell slot, while a remote node's props are JSON; the selectors therefore travel as
  ordinary sibling nodes rather than as UI nested inside a prop.
- The method chip in the request tree is no longer colour-coded per verb. A plugin names a role, never
  a colour, and the kit has no role that means POST.

Saved requests are attachable to an agent's context, served by the plugin's own
`/v1/p/http/context-options` and `/v1/p/http/context-capture` routes. Redaction runs on the Node, over
rows whose ciphertext has just been opened. Method, URL path, query keys, folder, auth mode, body
mode, and header names survive. Header values, the auth payload, the body, every variable, and every
literal query value do not. A `{{VAR}}` reference in a URL is kept, because a reference is shape and
its resolved value never exists at capture time.

Legacy `http-draft:*` keys from releases that persisted unsaved drafts in `localStorage` are swept by
the shell at renderer activation (`client-core/infra/persistence/legacyStorage.ts`), not by the plugin. A
frame's storage area is its own and could never have reached them.

## Shared model and region leases

Equivalent immutable model/grant affinity shares selection, drafts, saved lists, and send results
between list and detail. The opening item is not part of this model identity. Equal project/task ids
on different Nodes, QueryClients, or structural document grants do not join models.

Each region has its own action and client view. Save, delete, send, and clipboard work captures the
invoking region's bridge before awaiting. Retiring another region does not cancel that work. A retired
origin cannot publish a held result. Shared idempotent list reads can retry through a surviving
equivalent lease if their admitted lease retires, at most once per available bridge; mutations are not
replayed. The first bridge is reserved before resource construction, with rollback on construction
failure. The latest inactive model keeps its warm draft without retaining bridges or subscriptions.

### Draft recovery and acknowledgements

Full request drafts live in a worker memory registry outside the drawn tree and disposable subject
root. Identity includes Node, immutable authority, project, task, and saved request ID; each unsaved
request has a distinct local identity. A saved request restores its own edits when opened. The list's
**Recover unsaved edits** section opens other dirty drafts explicitly. Starting another request or
copying a saved request preserves dirty prior drafts. There is no draft size or count cap.

Save and delete capture the originating region, request identity, selection generation, and submitted
edit revision. Writes to one HTTP record run in order across project, task, and settings models on the same Node. Creation is single-flight: another submitted save
waits for the ID and updates that row. An older acknowledgement can advance the saved baseline but
cannot replace text entered afterward or select an unrelated request. Failed or retired saves retain
full drafts; retirement settles local status without acknowledging a successful write. An explicit
successful deletion discards its submitted draft, while edits entered during deletion remain an
unsaved recovery. Copy and curl export use the displayed full draft.

Variable editors retain full drafts under their equivalent authority and project. Held saves and
deletes reconcile by row identity and revision, and project changes retire their operations. Failed
refreshes retain last-known request and variable rows. A retired grant is never stored for a retry;
recovery requires a mounted equivalent grant, and saving remains an explicit action.

Recovery lasts for the worker lifetime, including equivalent warm remounts and replacement of its
latest inactive subject root. Worker eviction, plugin replacement, and application exit lose unsaved
memory. Drafts can contain credentials, so recovery does not write plaintext to device storage.
Legacy `http-draft:*` storage remains swept: its keys cannot establish exact Node and grant identity.

Response decoding uses the native byte decoder when available and an indexed portable fallback.
Both preserve `atob` input acceptance and UTF-8 replacement behavior, including BOM handling and
binary bytes. The response view retains base64, decoded bytes, and text; the optimization removes
transient iterator work, not those retained representations. Raw, formatted JSON, headers, timeline,
and copy continue to use the complete capped response.
