# Editor contracts, events and security

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-EDITOR`

## Queries and commands

| Contract | Kind | Authority | Result/commit |
| --- | --- | --- | --- |
| `acorn/editor.root.get@2` | query | task read | root availability snapshot |
| `acorn/editor.entries.list@2` | query | file read | paged entries |
| `acorn/editor.files.list@2` | query | repository/file read | paged ranked paths |
| `acorn/editor.file.read@2` | query/stream | file read | content and revision |
| `acorn/editor.search.query@2` | cancellable query | file read/fixed search | paged matches |
| `acorn/editor.file.write@2` | command | code write | atomic file replace |
| `acorn/editor.file.create@2` | command | code write/create | new file commit |
| `acorn/editor.directory.create@2` | command | code write/create | new directory commit |

`CUR-EDITOR-080` All contracts use the envelopes, authentication, deadlines, cancellation,
idempotency, concurrency and error semantics in
[`queries-commands-and-results.md`](../../contracts/queries-commands-and-results.md) and
[`errors-idempotency-and-concurrency.md`](../../contracts/errors-idempotency-and-concurrency.md).

`CUR-EDITOR-081` Queries return `snapshotSequence` and observed revision. Write/create commands
require one Node, one task/worktree generation, one target resource, delegated actor identity,
expected revision where applicable, and idempotency key.

`CUR-EDITOR-082` File read may become the standard large-payload stream; search remains paged JSON.
The Node applies negotiated file, page, match, excerpt and encoded-response ceilings before output.

`CUR-EDITOR-083` Error codes include `not_found`, `checkout_unavailable`, `permission_denied`,
`path_outside`, `symlink_denied`, `unsupported_encoding`, `content_too_large`,
`validation_failed`, `conflict`, `idempotency_conflict`, `cancelled`, `deadline_exceeded`,
`renderer_unavailable`, `plugin_unavailable` and `node_unavailable`.

`CUR-EDITOR-084` V1 routes `/:id/editor/root|files|list|read|file`, `/:id/search`, and every
`/api/v1/plugins/editor` endpoint are removed. V2 exposes only the declared query/command names
through the Node protocol; there is no path or token compatibility bridge.

## Events

Editor publishes no custom durable event for generic worktree mutations. Core owns:

| Event | Use |
| --- | --- |
| `acorn.core.file.created.v2` | invalidate tree/file pages |
| `acorn.core.file.updated.v2` | reconcile clean/dirty models |
| `acorn.core.file.deleted.v2` | mark tab missing and invalidate tree |
| `acorn.core.task.archived.v2` | close task-scoped view state |
| `acorn.core.checkout.replaced.v2` | invalidate all prior file handles |
| `acorn.core.permission.revoked.v2` | disable affected operations immediately |

`CUR-EDITOR-085` Editor subscribes only to exact declared core event types and task/resource
prefixes. Events invalidate/reconcile snapshots; they never authorize a read, write or reveal.

`CUR-EDITOR-086` File events contain URI, task URI, old/new revision, change class, actor class and
correlation only. They MUST NOT contain content, search excerpts, absolute path, secret, command
line or dirty Client text.

`CUR-EDITOR-087` Duplicate delivery is idempotent by `(nodeId,eventId)`. A sequence gap fetches an
authorized root/open-file snapshot before resubscription. Client-local presentation intents are
not placed in the durable event log.

`CUR-EDITOR-088` If Editor later publishes plugin facts, their names MUST be within
`acorn.editor.*`, declared in the manifest and incapable of masquerading as a core file commit.

## Exported renderer and navigation contracts

`CUR-EDITOR-089` Signed renderer-provider contributions activate descriptors for
`acorn.code-editor/2`, `acorn.file-tree/2`, `acorn.search-results/2` and
`acorn.diff-review/2`; descriptors contain semantics and limits, not Monaco APIs or DOM handles.
Electron refuses any provider target absent from its build-time allowlist.

`CUR-EDITOR-090` `acorn/editor.intent.reveal@2` is a Client navigation contract with task URI, file
URI, expected revision, position and layout policy. It has no filesystem side effect.

`CUR-EDITOR-091` Third-party consumers request renderer capabilities through the host and declare
the required major in their manifests. They cannot access Editor's Node grants or presentation
state through renderer use.

`CUR-EDITOR-092` Optional diagnostic providers export schema-bound ranges through the plugin
broker. They cannot inject code actions, language workers or executable links without separately
declared capabilities.

## Security controls

`CUR-EDITOR-093` The Node treats repository names, file names, encodings, bodies, Git output,
search queries and excerpts as hostile. All boundary values are strict-schema validated and
bounded before filesystem, process, event or renderer use.

`CUR-EDITOR-094` Path confinement is performed after normalization and again after opening using
race-resistant rooted APIs where supported. Tests MUST attempt `..`, absolute/UNC paths, encoded
separators, Unicode/case collisions, symlink swaps, hard links, FIFOs, sockets and device files.

`CUR-EDITOR-095` Search never evaluates a shell string, inherits no user ripgrep configuration and
receives only a minimal environment. Regex, glob and output parsing have independent time, memory,
match and response bounds.

`CUR-EDITOR-096` Renderer text is never interpreted as HTML. File names cannot become attributes
without platform escaping; code, excerpts, errors and diagnostics cannot create terminal, file,
URL or command actions except through typed host intents.

`CUR-EDITOR-097` File writes are high-impact repository mutations and appear in permission history
with actor, plugin, Node, task, resource, previous/new revision, byte count and result. File
contents and excerpts are omitted.

`CUR-EDITOR-098` Editor cannot access `.git` administrative files, Acorn data roots, another task,
another checkout generation or paths denied by repository policy unless a distinct core capability
explicitly names them.

`CUR-EDITOR-099` Secret-like file content receives the file's sensitivity classification. It is
not emitted to diagnostics, events, crash reports, telemetry, search analytics or Agent references.

`CUR-EDITOR-100` Clipboard write, external open and download are host actions requiring user
gesture and separate grant where offered. Editor requests no clipboard read.

`CUR-EDITOR-101` The Electron renderer runs sandboxed with context isolation, restrictive CSP and
no Node integration. Built-in renderer code receives typed host services only and no generic IPC;
the Editor package contributes no executable code to the app origin.

`CUR-EDITOR-102` A compromised remote Node can provide hostile file data but cannot supply or
replace Editor executable Client bytes. Electron obtains the exact locked digest independently and
revalidates all received semantic payloads.

`CUR-EDITOR-103` The Node companion is WASI with no ambient filesystem, environment, clock,
network or process access. Rooted file and search operations are broker imports carrying the
delegated caller and exact resource scope.

## Collaboration and failure semantics

`CUR-EDITOR-104` Agents, Rollbar, Changes and other consumers use only reveal, file-resource or
renderer contracts. Editor uses only core broker contracts and the optional Agents reference
export. No direct imports, private endpoints, callbacks or shared mutable stores are allowed.

`CUR-EDITOR-105` An Agent-originated file update is a normal core file event. Editor does not infer
that the Agent is authorized to receive current dirty text or to overwrite it.

`CUR-EDITOR-106` If optional Agents reference insertion fails, Editor reports the action error
without changing the file, selection or active tab.

`CUR-EDITOR-107` If search fails or times out, prior results are visibly stale and cannot navigate
without reauthorization. If a save fails before commit, retry remains safe with the same
idempotency key; after an unknown outcome, status is resolved before retry.

`CUR-EDITOR-108` Disablement revokes new operations, cancels search/read streams, prevents queued
saves and prompts for dirty text. A write already committed remains committed and its event/result
is recoverable.

## Contract acceptance

`CUR-EDITOR-109` Contract fixtures MUST cover every operation and error, unknown fields, size
bounds, stale revisions, duplicate idempotency keys, cancellation, Unicode columns, pagination,
event replay and renderer negotiation.

`CUR-EDITOR-110` Security tests MUST cover traversal and link races, fixed-tool argument injection,
malicious regex/glob, hostile UTF-8/file names, oversized output, renderer XSS, event content
leakage, confused-deputy calls and post-revocation handles.

`CUR-EDITOR-111` Collaboration tests MUST prove a low-authority consumer cannot use Editor's file
grant, an Agent reference contains no implicit content grant, and a reveal intent for another Node
or task is rejected.

`CUR-EDITOR-112` Client provider tests MUST prove remote implementation substitution,
non-allowlisted renderer ID, unknown renderer major, missing WASI counterpart and quarantined
installation all fail closed with the specified fallback.

`CUR-EDITOR-113` Audit tests MUST prove write activity is attributable without storing content and
read/search activity is not logged at content granularity.

`CUR-EDITOR-114` File-watch/event storms are coalesced only for presentation invalidation; durable
core events retain their defined semantics and the current revision is always fetched before save.

`CUR-EDITOR-115` All operation schemas are immutable and digest-pinned in the manifest. Compatible
minor versions may add optional safely ignorable output fields but cannot widen authority or
reinterpret paths/revisions.

`CUR-EDITOR-116` The plugin health endpoint reports Node runtime, broker compatibility, fixed-tool
availability and Client renderer health without disclosing executable paths, repository paths or
file names.

`CUR-EDITOR-117` The plugin requests no secret or network grant. Any future remote language service
is a separate optional dependency and permission change, not an implementation detail.

`CUR-EDITOR-118` Full-disk encryption protects ordinary cached file/search state; no application
secret encryption key is needed because Editor persists no content or credentials.

`CUR-EDITOR-119` Editor is contract-complete only when every V1 bridge, route, pane action, client
event and persistence key maps to a declared V2 operation, intent, state owner or explicit removal
in this specification.
