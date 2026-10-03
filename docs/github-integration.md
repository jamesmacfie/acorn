# GitHub integration

## Typed pull-request source

The `github/pull-requests` [data source](./data-sources.md) requires an explicit GitHub connection
and `parameters.repository` in `owner/name` form. Repository options enumerate repositories available
through that connection, with continuation cursors. Option search filters each returned page; an empty
page with a cursor is not exhaustion.

Records use GitHub node IDs for identity. Actual `state` is `open`, `closed`, or `merged`; `closed`
means closed without merging. Draft, mergeability, merge readiness, and auto-merge remain separate
fields. Author login is nullable, and timestamps use epoch milliseconds. Row URLs retain the
content-link action that opens a tracked pull request inside Acorn.

Queries support equality on state, author login, and draft, ordered comparisons on created/updated
time, and `all` groups. Number, created time, and updated time support sorting. The provider search
narrows candidates, then exact typed comparisons run over the exhausted selection. Author equality
uses the returned login's case. Repository and author values cannot inject search qualifiers.

The adapter reads at most 10 pages of 100 search matches. A provider count above 1,000 or continuation
past that limit returns `incomplete`, including when the query requests a smaller `take`. Stable
sorting uses node ID to break ties before applying `take`. This source advertises neither details
nor incremental checkpoints. Search consistency remains subject to GitHub's indexing and concurrent
changes during pagination.

Continuation selections expire after 60 seconds. The plugin holds at most 16 selections and 16 MiB
across them, bound to owner, connection, full scope/query, evaluation time, and mode. Invalid or expired
cursors fail; callers must refresh. Connection and principal checks also apply to cached continuation
reads. Credentials stay inside the provider callback, and cancellation reaches the GitHub request.

Provider APIs were checked on September 13, 2026 against GitHub's
[search schema](https://docs.github.com/en/graphql/reference/search),
[pull-request schema](https://docs.github.com/en/graphql/reference/pulls),
[user repository connection](https://docs.github.com/en/graphql/reference/users), and
[search qualifiers](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests).
The mirror and dashboard collection retain their separate readers until the consumer migration.

GitHub is a provider plugin, not the acorn authentication system. Its token is an encrypted
integration credential and its repositories/PRs are a disposable local mirror.

## Connecting

Settings' Add connection and the first-run wizard both run the OAuth device authorization flow through
the same `createDeviceFlow` helper in `packages/client-core/src/features/integrations/deviceFlow.ts`, so the
polling cadence (the advertised interval, `slow_down`, `expires_in`) is stated once:

1. `POST /v1/p/github/auth/device/start` asks GitHub for a device code.
2. The owner enters the user code at GitHub's verification URI.
3. `POST /v1/p/github/auth/device/poll` checks the provider at GitHub's requested interval.
4. On success the Node validates the token and stores it in an encrypted `integrations` row. The
   GitHub account is provider metadata; it does not bind the node-owner identity, which core mints at
   boot.

The optional GitHub plugin defaults to acorn's public client ID, `Ov23liRC5Y5yDF7BTSeg`, so
**Connect GitHub** appears in Add connection and first-run setup without environment configuration.
Set `GITHUB_CLIENT_ID` to use your own GitHub app, and enable **Device Flow** in that app's settings.
The plugin trims the override. An empty or whitespace-only override reports `connectable: false`
and hides GitHub from those connection surfaces. A connection stored earlier keeps working.
The device grant uses no client secret or callback URL.
`githubToken(c)` is the single credential read site for GitHub routes.

Device flow wins over the redirect web flow for three reasons. The web flow needs a client secret to
exchange the code, and a secret shipped inside a distributed binary is recoverable; device flow
exchanges on `client_id` alone. The web flow needs a redirect URI, and the renderer has no
server-served origin to redirect back to, while a remote node would need its own registered callback
URL; device flow has neither problem, so a local node and a remote node run the same code path. The
web flow also needs a shell-owned auth window to intercept the redirect. The cost is one extra step
for the person connecting: they read a code and type it at `github.com/login/device`.

## Mirror

The GitHub plugin database contains repositories, pull requests, PR files, reviews, comments,
commits, review threads, labels, requested reviewers, checks, freshness, viewed files, and pinned
repositories. Provider reads are serve-then-revalidate and may use ETags. List refreshes replace
collections so inaccessible repositories/PRs disappear from the local projection.

`plugin:github:repos-changed` announces a completed full repository-list replacement or a repository
inserted by a live lookup after a mirror miss. A `304 Not Modified` response updates only freshness
and does not send the event. Node-side plugins can use the user-scoped `github.mirror` capability to
list the same repository inventory without calling GitHub.

Patch bodies and full file bodies use the Node's immutable on-disk blob cache. A patch body is keyed
by a SHA-256 digest of its own text. A full file body is keyed by its blob SHA. A blob miss fetches
from GitHub and stores the result. The cache is per Node and can hold private repository data.

### Pull request detail and files

A pull request's mirror is two resources, each with its own `sync_state` row: the detail
(`pr:<repoId>:<number>`) and the files (`files:<repoId>:<number>`). Both are fetched in full before
anything is written, in `plugins/github/src/server/routes/mirror/prFetch.ts`, and swapped in by
`prMirror.ts` in one `db.batch` with their sync row. A failure on any page leaves the previous rows,
the stored completeness, and `fetched_at` exactly as they were, and the route serves the old mirror
stale or, cold, reports the provider failure.

The detail is one GraphQL query for the scalars and the first page of every connection, then cursor
continuations through `node(id:)` until each connection is exhausted. The connections are labels,
reviews, review requests, issue comments, commits, review threads, each thread's comments, and the
latest commit's status and check contexts. Every page asks for 100 nodes and `pageInfo`. One walker
handles every connection. It fails on a page of the wrong shape, a node with no identity, or a
repeated or missing cursor while `hasNextPage` is true. It keeps a node that appears on two pages
once, where it first appeared. Thread comments continue four threads at a time. A GraphQL response
with `errors` is a failed refresh even when it carries partial data. There is no batch-only query:
the batch route refreshes each stale pull through the same helper, three at a time, because a
multi-alias query would stop at each connection's first page.

One gap in that honesty is not closed. GitHub's REST endpoint lists at most 250 commits for a pull,
and whether the GraphQL `commits` connection stops there too, with `hasNextPage` false, is not
confirmed. If it does, the walker takes the first 250 as the whole list, because it compares the
walked list against nothing. The fix is to ask for the connection's `totalCount` and carry a
shortfall to the conversation, which needs a mirror column; the checks would also have to be read
from `headRefOid` rather than `commits(last: 1)`, which would then name the 250th commit.

The files come from the REST files endpoint, 100 a page, in order. The walk stops at a short page, at
a full page with no `rel="next"` link, or after page 30, which is GitHub's 3,000-file ceiling. After a
full page 30 the plugin reads the pull's `changed_files`. If that is more than 3,000, or GitHub gives
no count, the resource is stored as incomplete with cause `upstream-cap`; 3,000 of 3,000 is complete.
A repeated path or a malformed page fails the refresh. Nothing works around the ceiling with a clone
or an archive download.

Every mirrored child row has a `position`, its zero-based place in GitHub's order, and every read
orders by it. File rows carry a patch state. `available` means `patch_key` names a body in the blob
cache. `unavailable` means GitHub sent no patch, which happens for binary files, very large diffs,
and pure renames. Patch bodies are written, eight at a time, before the swap; an orphaned body is
only cache data. A read that finds an available body missing is an integrity failure, not a file
without a diff: the files route treats the mirror as cold and blocks on a refresh that rewrites it.

The client states what the files route reports. When the list is capped, the diff and the PR's file
list both show a warning above the files, with GitHub's count when it gave one. File counts are the
files received.

### Diff documents

The diff viewer reads a pull request as a document ([diff-rendering.md](./diff-rendering/document.md) § The
document), not as patches. When the files mirror writes a patch body, it also cuts the patch into
segments with `@acorn/diff-document` and writes the segment descriptors as a small blob beside it,
`diffdoc:v<version>:<patch digest>` (`plugins/github/src/server/routes/mirror/prDocument.ts`). Both
blobs are written before the swap, so the swap still publishes a complete revision or nothing. A patch
whose descriptor blob already exists is not cut again. The cut runs on the node's own thread, and a
refresh of an unchanged pull request every 45 seconds would otherwise repeat it for every file.

`GET /repos/:owner/:repo/pulls/:number/diff` is the document. It is served from the same files
resource and the same refresh as the files route, reads the file rows in provider order and each
available file's descriptor blob, and parses nothing. A descriptor blob that is missing, which is
every file of a mirror written before documents existed, is cut from the patch body and stored on
that read. A missing patch body is the same integrity failure the files route repairs, and it repairs
the same way. The answer is `{ document, completeness }`, with no patch text in it. A 2,200-file,
million-row pull request is about 27,000 segments and a 2.5 MB document.

Segments and search are two repository routes, because a segment is addressed by its patch digest and
a compare preview stores its patches the same way: `POST /repos/:owner/:repo/diff/segments` answers up
to 32 segments by path, digest, and ordinal, cut from the patch body again, with parsed patches held
in a 64 MB process-local cache for the next batch; `POST /repos/:owner/:repo/diff/search` answers a
page of matches over the files the request names. Access is the repository's, resolved the way the
blob route resolves it, and a digest must be one this plugin could have written before it becomes
part of a blob key.

A known limit: patch blobs are keyed by digest across the whole node, not per repository, and neither
route checks that a digest belongs to the repository in its path. Anyone who can read one repository
and knows a digest can read that patch from any repository the node has mirrored. With one identity
per node that grants nothing new. It matters if one node serves several identities with different
access, and the fix is to check the digest against that repository's file rows or compare record.

Inline threads are not in the document. They come with the PR detail, which is complete when it is
served, and the viewer places each one by its line number from the document's segment line spans, so
its space is reserved before its segment loads. The diff source reports loading until both the
document and the detail are in. The two mirrors refresh separately, so for one refresh interval the
threads can describe an older head than the files; the thread whose line no longer exists in any
segment is simply not drawn.

## Reads and writes

Editor pull-request markers resolve the authorized task root and user-scoped mirror on every read.
Overlapping reads share only active PR-head, base-ref, and merge-base resolution with matching root,
user, mirror repository, pull number, base ref, and head SHA. The wave is removed on success or failure;
a subsequent request resolves mutable refs again. Each file runs its own PR diff and fresh
PR-head-to-worktree translation. Remote base refs precede local refs, the resolved head must match
the mirror's exact SHA, and missing refs produce no PR contribution. Diff failures do not publish
untranslated ranges. Literal pathspecs and disabled external diff and text conversion preserve file
and line identity. [Editor marker custody](./editor/line-markers.md#line-provenance-markers) owns disk/body matching.

The GitHub source provides repository browse, PR lists/detail, diff files, checks, Actions logs,
mentions, labels, reviewers, comments, review threads, and create-PR. Mutations call GitHub first and
then update or invalidate the affected mirror so a subsequent read does not serve a known pre-write
value.

PR detail keeps the mirror's serve-then-revalidate behavior, including provider-rendered `bodyHTML`.
That HTML can contain GitHub `private-user-images` URLs signed for only a few minutes, so a stale read
may briefly carry an expired URL. `plugin:github:pr-synced` means that the local pull request mirror
was committed or invalidated, so consumers re-read the identified pull request. The plugin sends it
after a background refresh and after a successful PR mutation updates or invalidates mirror state.
A provider refresh after a mutation can send a second event. This replaces signed HTML and keeps
other clients and plugins in sync with the initiating client.

The create-PR compare preview reads GitHub's compare endpoint directly and mirrors no rows. GitHub
lists at most 300 changed files for a whole comparison, on the first page only, and gives no total.
So a comparison with 300 files reports `upstream-cap` for resource `compare-files`, and the preview
and the create form's file count say that only the first 300 files are shown. The commits come from
the first page too, which is enough for the title prefill. GitHub sends every patch inline; the route
stores each under its digest in the blob cache, as the files mirror does, and answers a diff document
rather than the patches, so the preview reads its segments through the same two repository routes as
a pull's diff (§ Diff documents).

Creating a pull request sends `plugin:github:pulls-changed` after the plugin invalidates the owning
repository's open-pull list. The interactive route and `github_pull_create` agent tool share this
write path.

The task-scoped `github_pull_create` agent tool shares the same create service as the interactive
route. It infers the head from the task branch, uses the requested base, and atomically attaches the
created PR through `CoreServices.tasks.attachPull`: the first attachment claims
`tasks.pull_number`, while later attachments become durable related rows with the managed session id.
After a managed agent turn completes, the GitHub plugin checks the task branch for an open PR using
the Node owner's GitHub connection. A single result whose head and base repositories match the task
project is adopted into active tasks on that branch that have no primary PR. The task-change event
refreshes client task caches, which enables the **Pull request** pane in the right rail without opening the
repository's PR list. Tasks without a branch or GitHub project, and tasks with a primary PR, skip the
lookup. Ambiguous results and fork heads are not adopted. This lookup uses GitHub's
[head filter](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests) and does not replace the
repository's full PR mirror with a branch-filtered list.

Shelling out to `gh pr create` gains this branch adoption but no agent attribution: discovering a PR
after a turn does not prove who created it. A missing connection leaves the task unchanged. Provider
failures are logged and another completed turn can retry; the check runs without a connected client
and does not delay the agent's completion event. There is no startup replay of completed turns.

Two read-tier tools sit beside it. `pr_review_comments` returns the submitted reviews, the inline
threads and the conversation comments for the task's PR, and `pr_checks` returns every mirrored check
with the failing ones named. Both read this plugin's mirror, so neither spends the credential or
touches the network, and both distinguish an unmirrored PR from an empty one. Before they existed, an
agent asked to address review feedback had to shell out to `gh` against data acorn already had
([agent tools](./agent-tools.md) § GitHub).

The "my pull requests" collection filters by involvement (review-requested, assigned, authored) as a
live GitHub search rather than a mirror query. Assignees are never mirrored, and review requests only
mirror through the PR-detail sync, which runs only for PRs already in the mirror because this account
opened them. A mirror-side filter would parse and render, then answer nothing for the question the
person is asking. Each involvement value runs as its own search and the results are unioned, because
GitHub's search qualifiers only AND, and "assigned to me or waiting on my review" is two questions
however it is asked.

## Content links

GitHub declares two content-link recognisers (`plugins/github/src/client/contentLinks.ts`; the shared
recognition and destination ladder is in [plugins.md](./plugins.md) under Client authoring and the UI
kit). A `github.com/<owner>/<repo>/pull/<n>` URL declares `providerId: 'github'`, so a click can open
the reference panel: a pull request is glance-sized enough to answer "what is this" without the reader
losing their place. A bare `github.com/<owner>/<repo>` URL declares no `providerId`, because a
repository is a list rather than a card, and its destination is the browse route.

Both recognisers resolve `owner/repo` to a tracked project by comparing case-insensitively. GitHub
treats an owner and a repo name as case-insensitive, but the two sides of that comparison come from
different places: a URL, and the plugin's own PR mirror, carry GitHub's canonical spelling (for
example `Runn-Fast`), while `projects.github_owner` is stored folded to lower case (`runn-fast`). An
`===` comparison here matched neither a dashboard row nor a PR link inside a rendered body, and it
failed silently, because an unresolved repo simply opens the real `github.com` URL instead of erroring.

## Importing projects

`POST /v1/p/github/import` requires a paired device because importing creates or repoints a core
project and can clone into an owner-selected folder. Task and service credentials receive
`403 interactive_user_required` before body parsing, mirror reads, or Git and project operations.
This gate does not change the authority of other GitHub provider routes.

Projects → Import from GitHub discovers repositories from the plugin's disposable mirror. A
repository is either linked to an existing folder (**Link folder**, the `map` action) or cloned with
non-interactive Git. Both ask for
the folder before anything is written, so cancelling the dialog cancels the import. There is no third
"defer" action: skipping the repository is what deferring meant, and the path-null placeholder
project it created turned into a duplicate as soon as the same repository was mapped.

So an import that finds a path-null project for the repository fills that one in rather than adding a
second. A project that already has a path is a real checkout, and two clones of one repository stay
legal (`projects_github_idx` is deliberately non-unique).

The importer returns an individual result for every repository, so a failed clone does not hide
successful imports. The mirror remains disposable candidate data; project identity, checkout paths, and
default branches come from core project facets and services.

Closed PR lists are paginated live provider reads. Open lists, details, and files use the local mirror
with explicit force-refresh support. GraphQL errors and provider authorization failures are mapped to
the common API envelope and surfaced as GitHub-specific status where the UI needs it.

## Tasks and references

A PR can promote to a task. The task stores the core project ID and pull number; the project's GitHub
facet supplies provider owner/name metadata. Subsequent task context and changes use the owning Node.
The PR pane keeps that scalar PR as its primary and adds read-only tabs to the strip from three
sources: durable
`task_pulls` relations, the connected base/head graph of the mirrored open-PR list, and PR links in
the primary description, comments, reviews, and threads. A pull body is GitHub's rendered HTML, and
only the `/pull/` form of a link is taken, so a `Fixes #42` that GitHub wrote as an issue link stays
out of the strip. Stack and mention evidence is derived on read, so retargeting a stack or editing
out a link removes it without a cleanup migration. A linked task destination wins over agent,
mention, and stack destinations; an agent destination opens the recorded managed session through the
existing notice-target seam.

The strip is the kit's `Tabs`, and every tab is labelled `#1234`, so each one carries the mark of the
destination it has: a list for a linked task, a bot for the agent that opened it, a link for a
mention, a branch for a stack neighbour. Selection follows focus in a tablist, so a tab only ever
changes which pull the pane reads. Taking the destination is a control beside the strip, acting on
the selected tab, which is what keeps a reader arrowing along the strip from being carried off to
another task.

The strip is drawn on the desktop only. A terminal has a few lines of chrome above the pane and the
strip wants a whole row of them, so there it collapses to the primary PR; the related ones stay
reachable from the pull list.

Selecting a related PR with no task offers **Create task** beside the strip. Promotion reuses the
repository-list workflow: the new task takes the matching core project, the PR head branch and pull
number, and any unambiguous Linear references from the PR body. If active tasks already own that PR,
the offer is replaced by a control that opens the one owner, or by a chooser over several.

Within a task PR body, another GitHub PR link is a `plugin:select` intent for the existing PR pane,
not a route change or reference-panel overlay. Which pull is selected changes what the navigator and
the diff read but never changes the current task's scalar primary, branch, or worktree. All GitHub writes,
including diff comments and thread actions, are omitted on a non-primary pull.

Linear reference panels are contributed through a provider contract, so the GitHub plugin does not
import Linear's implementation. Linear is a loaded plugin, so the panel it renders there is a
sandboxed frame whose overlay chrome the host draws. GitHub does depend on `@acorn/plugin-linear` for
two things in `contract/`: the ticket-reference text scanner and the query-options factory over
`/v1/p/linear/issues`. Both are the sanctioned cross-plugin surface, and neither reaches Linear's
UI.

## Actions and logs

Checks expose Actions run/job data. Job logs follow GitHub's signed redirect without forwarding the
GitHub bearer to the blob host. Rerun-failed-jobs is an explicit mutation and requires the provider
permission GitHub reports.

A check row with a run behind it opens that run's steps in a modal: failed steps start open, and the
first one opened fetches the whole job log once and slices every step out of it.

## Surfaces

Every GitHub surface is a host layout filled with kit components; the plugin ships no stylesheet
([panes.md](./panes/layout.md) § Layout model, [ui-design.md](./ui-design.md) § The closed kit).

| Surface | Arrangement |
| --- | --- |
| The PR pane | The `single` layout holding one split: the navigator beside the diff, which is browse's inner pair without browse's pull list. The navigator opens with the strip of pull requests this task is about. |
| Navigator | Overview, then the changed files and the conversation as folds. Browse and the PR pane draw the same three trees over the same model. The shared split control closes this column to its edge, keeps its content mounted, and remembers the choice on this device. |
| Overview | The pull's heading and facts (state, author, branch, review decision, checks, age), the merge box, the conflict alert, description, linked issues, labels, checks, reviewers, and the `github:summary-badges` slot. The merge box is two left-aligned rows: the one solid primary for the pull's state (**Merge** beside its method, or **Ready for review** on a draft), then **Convert to draft** and **Close**. A related pull says it is read-only instead. |
| Conversation | The comment and review composers over a timeline of cards: comments, review summaries, commits, and file threads. |
| Browse | Two splits, one inside the other: the pull list, then the navigator beside its diff, or the create form beside its compare preview. |
| The reference panel | A heading, facts, and the host's task-link control, in the box the host draws. |
| The importer | A titled card on the Projects page of setting rows, one per repository, with **Clone** and **Link folder** beside it. A repository that already has a project says "Added as" that project and keeps both buttons. In onboarding the wizard is the frame. |

Two places let another plugin in. `github:diff-line` takes marks on a line of a pull request's diff,
keyed by file, line and side, the same shape the changes pane opens over the working tree.
`github:summary-badges` is a `stack` slot on the overview, so github's own facts stay and up to four
contributors are added beside them ([plugins.md](./plugins.md) § Cooperative extension points).

### Conversation

The conversation is `PrConversation` in `plugins/github/src/client/pullDetail/Conversation.tsx`, a kit
`Timeline` over `buildConversationEntries` in `model.ts`. Its topology is the PR detail, which is
complete when it is served (§ Pull request detail and files), and no route was added for it. Bodies stay
in that detail, because the diff's inline threads and the Linear reference scan read the same bodies
anyway, so a separate body route would fetch them twice.

- **Turn identity.** Every entry's key is `kind:id`: `review:<node id>`, `comment:<id>`,
  `commit:<sha>`, `thread:<thread id>`. The kind stops a SHA, a review id, and a comment id from sharing
  a namespace. An id seen twice in one kind gets `#2`, `#3` in list order. The sort is stable, so a tie
  keeps the order reviews, comments, commits, and threads are listed in. Turns are drawn by key, each
  reading its entry from a signal of its own, so a refetch, a reply, an edited body, or an older comment
  arriving keeps every existing turn's element.
- **Bodies near the viewport.** Each turn's byline, state, and path are drawn at once. GitHub's rendered
  HTML is built only when the turn comes within one screen of the viewport, through `Timeline.Turn`'s
  `near` child, and it stays built after that. Until then the card says the body is shown on scroll.
  Browser find cannot match a body that is not built yet. The terminal client builds every body at once.
  The observer's root is the region scroller found when the first body asks, and it stays that
  element. If the navigator's region were rebuilt around a mounted conversation, bodies would wait
  for a scroller that no longer moves.
- **Thread snippets.** A thread quotes five lines around its line, from the one segment of the pull's
  diff document that holds it (§ Diff documents), so a line at a segment's edge gets less context on
  that side. The conversation loads the document when any thread
  has a line, and `createDiffSnippets` from `@acorn/plugin-api/ui/diff` reads a thread's segment through
  the diff viewer's loader and node cache once its turn comes near. A segment already seen in the diff
  costs no request, and one read here is resident when the diff opens. A file missing from the document
  because GitHub capped the list, a file with no patch, a line in no segment, and a failed load all
  draw **Snippet unavailable.** and load nothing else. An outdated thread has no line and draws no
  snippet. No patch is parsed on the client.
- **No window.** The conversation draws every turn. Its cost per turn is a byline until a turn comes
  near, and it scrolls in the navigator's region rather than a followed timeline of its own, so it does
  not use the transcript's "Show earlier" window.

Keyboard navigation comes from the tree rather than from this plugin: the pull list, the file list,
the check list and the pull strip are kit collections, so the arrows, `j` and `k`, Home, End and
type-ahead all work without a binding of github's own. What is left in `Shortcuts.tsx` is the keyboard
for what is not a list: the file finder, `[` and `]` cycling, and "create pull request". All three are
commands now, and the section below says which of them the palette carries as well.

## From the command palette

Shipped 2026-09-03. Seven commands: six built as a function of what the router says
(`plugins/github/src/client/commands.ts`) and one registered at boot beside the rail source
(`plugins/github/src/client/index.ts`). How the palette itself works is
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md); what belongs here is this
plugin's share of it.

| Command | Kind | Chord | In the palette |
| --- | --- | --- | --- |
| Open GitHub (`source.github.open`) | action | `⌘0` | Yes |
| Edit keyboard shortcuts (`help.shortcuts.open`) | action | `?` | No — the reference is a Settings page, and the palette already has a row that opens Settings |
| Find file in this pull request (`github.files.find`) | `search` | `/` | Yes |
| Next changed file (`github.files.next`) | action | `]` | No |
| Previous changed file (`github.files.previous`) | action | `[` | No |
| Find pull request (`github.pull.find`) | `search`, project-scoped | none | Yes |
| Create pull request (`github.pull.create`) | action | `c` | Yes |

`plugins/github/src/client/commands.test.ts` pins the six the component builds, in that order, and the
three of them that carry `palette`. Cycling is not one of the three: `[` and `]` step through a list
that is already on screen, and opening a palette to move one file forward costs more than the move.
Five of the six are gated on the route — the three file commands need a pull request open, and finding
or creating one needs the routed project to have a GitHub repository. `when` on the command and
`active` on the binding read the same accessors, so a palette row disappears for the same reason its
key stops doing anything.

They are registered per mount from `plugins/github/src/client/Shortcuts.tsx` rather than through
`ctx.commands`, because every one of the six needs the router: which project is routed, which pull
request is open, and where to navigate. A plugin's `init` runs at boot with no router in scope. The
decisions are still built in `commands.ts` out of eight accessors the component passes in, for the
reason `plugins/github/src/client/pullList/model.ts` exists — a decision worth testing should not need
a DOM to reach. The rail-source command needs no router and is registered the ordinary way.

**The changed-file finder was an overlay until 2026-09-03** — a second command-palette-shaped dialog
with its own query, cursor, key handling and list. It is a `search` command on the shared session now.
What moved is who owns the dialog; nothing a reader touches moved with it.

- **`/` keeps its typing exemption and its route gate.** The binding is `typing-exempt`, so the bare
  key fires wherever the reader is in the pull request but not from inside a filter box or a comment
  composer, where a slash is a slash. It exists only while a pull request is open.
- **The order is the one order.** `plugins/github/src/client/changedFiles.ts` owns a pull request's
  changed-file order and its `?file=` target, and three places write that parameter — this finder, `[`
  and `]` cycling, and the file list in the navigator — so all three read the same file-summaries
  query. An empty query is that order; a ranked query keeps it as the tie-break. Ranking is over the
  whole path rather than over the filename and the directory a row draws separately, so `client/App`
  still matches `src/client/App.tsx`.
- **Picking a file writes `?file=`, and that is what makes the pick outlive the palette closing.** The
  URL is the selection and the diff reads it as its scroll anchor, so nothing has to be handed back
  out of a dialog that is already gone. A file the pull request no longer changes is refused rather
  than selected.

**The `overlay` slot component draws nothing, and is not dead code.** `Shortcuts.tsx` returns `null`.
It is kept because a registration that needs the router has to be mounted inside one, and a slot is how
this plugin gets a component mounted in the shell at all. It stays a `.tsx` sibling rather than a line
in `index.ts` (`plugins/github/src/client/slotContribution.tsx`) because this is the one slot whose
component needs a prop wired from the slot context — `onOpenShortcuts`, which the contribution fills
from `props.context.openSettings('shortcuts')` — and a JSX wrapper is how a slot adapts a component to
the host's props contract.

The cost of mounting that way is named in `docs/tui.md` § What a plugin loses here: the terminal host
does not fill the `overlay` slot, so both of these searches are desktop-only. The editor's `⌘P` is not,
because it is registered in its plugin's `init` ([editor.md](./editor/editor-pane.md) § From the command palette).

**Finding a pull request stays project-scoped and capped.** `scope: 'project'`, because the list is the
routed repository's open pull requests and there is no fleet or workspace query behind it to widen it
to. One read serves a whole palette session, so typing after the frame opens costs nothing, and
matching reuses the browse list's own `filterPulls`, so the palette finds a pull request by the same
words the filter box does: its number, its title and its author. `MAX_PULL_ROWS` is 50 — the same
number the session caps any search at, said here so the provider keeps its own promise rather than
leaning on the host to keep it. Picking a row selects the GitHub rail source and then navigates, in
that order, because the shell draws from the selected source rather than from the location.

What is deliberately not a command: merging, converting a draft, submitting a review, commenting,
changing labels or reviewers, and rerunning checks. Every one of them needs the pull request in front
of you — which pull, which file, which thread, and what state it is in — so every one of them stays in
the surface that shows it. A palette row would have to rebuild that context or act without it.
