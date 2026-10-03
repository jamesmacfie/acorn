# HTTP client surfaces

This page covers the HTTP plugin's three surfaces, its palette rows, how a saved request reaches an
agent's context, and how drafts survive between regions. The client is in `plugins/http/src/client/`.

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

## From the command palette

Three rows under an **API** group ([command palette](../command-palette-and-shortcuts.md)), all declared in the
manifest and all served by this plugin's own node half.

| Row | Kind | What it does |
| --- | --- | --- |
| Find a saved request | search, project-scoped | `/v1/p/http/palette/requests` answers the routed project's saved rows; picking one navigates to `http-project`, the same address the rail row has |
| New request | action | Delivers `new-request` to the `http` pane, where the panel starts a blank draft, the same thing the **New request** button does |
| Import a curl command | input, task-scoped | `/v1/p/http/palette/import-curl` parses the pasted command, saves it encrypted against the task, and opens the pane on it |

Two properties are the point of the pair, and both are structural rather than a filter applied
afterwards.

**The search cannot return a secret, because it never reads one.** The URL, the headers, the body, the
auth block and the variables are the five columns the node encrypts. The palette's query selects `id`,
`name`, `folder` and `method` and nothing else, so no ciphertext is opened anywhere on the path and a
row has no field a credential could occupy, not even the URL, which the rail beside it also leaves
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
components ([the tree contract](../plugins/descriptors.md#the-tree-contract)). Four consequences are visible in the UI, and all
four are the same consequence: the plugin has no document of its own.

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

## Draft recovery and acknowledgements

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
