# GitHub integration

GitHub is a provider plugin, not the acorn authentication system. Its token is an encrypted
integration credential and its repositories/PRs are a disposable local mirror.

## Connecting

Settings → Integrations and the first-run wizard both run the OAuth device authorization flow through
the same `createDeviceFlow` helper in `packages/client-core/src/features/integrations/deviceFlow.ts`, so the
polling cadence (the advertised interval, `slow_down`, `expires_in`) is stated once:

1. `POST /v2/p/github/auth/device/start` asks GitHub for a device code.
2. The owner enters the user code at GitHub's verification URI.
3. `POST /v2/p/github/auth/device/poll` checks the provider at GitHub's requested interval.
4. On success the Node validates the token and stores it in an encrypted `integrations` row. The
   GitHub account is provider metadata; it does not bind the node-owner identity, which core mints at
   boot.

The optional GitHub plugin reads `GITHUB_CLIENT_ID`, uses no client secret, and needs no callback URL.
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

Patch bodies and full file bodies use the Node's immutable on-disk blob cache. A blob miss fetches
from GitHub and stores the result by SHA. The cache is per Node and can hold private repository data.

## Reads and writes

The GitHub source provides repository browse, PR lists/detail, diff files, checks, Actions logs,
mentions, labels, reviewers, comments, review threads, and create-PR. Mutations call GitHub first and
then update or invalidate the affected mirror so a subsequent read does not serve a known pre-write
value.

PR detail keeps the mirror's serve-then-revalidate behavior, including provider-rendered `bodyHTML`.
That HTML can contain GitHub `private-user-images` URLs signed for only a few minutes, so a stale read
may briefly carry an expired URL. When the background refresh commits, `plugin:github:pr-synced`
invalidates the matching active detail query and replaces that HTML with the freshly signed version;
the event is part of the read contract rather than only a notification for other plugins.

The task-scoped `github_pull_create` agent tool shares the same create service as the interactive
route. It infers the head from the task branch, uses the requested base, and atomically attaches the
created PR through `CoreServices.tasks.attachPull`: the first attachment claims
`tasks.pull_number`, while later attachments become durable related rows with the managed session id.
Shelling out to `gh pr create` still has only branch-adoption semantics and does not gain agent
attribution.

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

Projects → Import from GitHub discovers repositories from the plugin's disposable mirror. A
repository is either mapped to an existing folder or cloned with non-interactive Git. Both ask for
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

Selecting a related PR with no task offers `+ Task` beside the strip. Promotion reuses the
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
`/v2/p/linear/issues`. Both are the sanctioned cross-plugin surface, and neither reaches Linear's
UI.

## Actions and logs

Checks expose Actions run/job data. Job logs follow GitHub's signed redirect without forwarding the
GitHub bearer to the blob host. Rerun-failed-jobs is an explicit mutation and requires the provider
permission GitHub reports.

A check row with a run behind it opens that run's steps in a modal: failed steps start open, and the
first one opened fetches the whole job log once and slices every step out of it.

## Surfaces

Every GitHub surface is a host layout filled with kit components; the plugin ships no stylesheet
([panes.md](./panes.md) § Layout model, [ui-design.md](./ui-design.md) § The closed kit).

| Surface | Arrangement |
| --- | --- |
| The PR pane | The `single` layout holding one split: the navigator beside the diff, which is browse's inner pair without browse's pull list. The navigator opens with the strip of pull requests this task is about. |
| Navigator | Overview, then the changed files and the conversation as folds. Browse and the PR pane draw the same three trees over the same model. |
| Overview | The pull's heading and facts, the actions toolbar, the conflict alert, description, linked tickets, labels, checks, reviewers, and the `github:summary-badges` slot. |
| Conversation | The comment and review composers over a timeline of cards: comments, review summaries, commits, and file threads. |
| Browse | Two splits, one inside the other: the pull list, then the navigator beside its diff, or the create form beside its compare preview. |
| The reference panel | A heading, facts, and the host's task-link control, in the box the host draws. |
| The importer | One row per repository with Clone and Map beside it. |

Two places let another plugin in. `github:diff-line` takes marks on a line of a pull request's diff,
keyed by file, line and side, the same shape the changes pane opens over the working tree.
`github:summary-badges` is a `stack` slot on the overview, so github's own facts stay and up to four
contributors are added beside them ([plugins.md](./plugins.md) § Cooperative extension points).

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
| Go to GitHub in the left rail (`source.github.open`) | action | `⌘0` | Yes |
| Open keyboard shortcuts (`help.shortcuts.open`) | action | `?` | No — the reference is a Settings page, and the palette already has a row that opens Settings |
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
because it is registered in its plugin's `init` ([editor.md](./editor.md) § From the command palette).

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
