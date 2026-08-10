# linear → loaded plugin — what the move exposed

**Done.** linear is out of both compiled composition lists and ships as a loaded package: a node
bundle serving `/v2/p/linear` through the portable fetch carrier, a client bundle drawing two frames,
and manifest descriptors for the rail source, the content-link recognisers, the command and its chord.
`id: "linear"` is preserved, so provider ids, route paths, stored connections, task links and the
`linear` task origin all carry over untouched.

It was chosen for one reason and it delivered on it: linear is the first plugin to run a **frame
reference panel** and **declarative content links** in production, and both broke in ways nothing had
noticed. The brief this file replaces said "Blockers: none". That was wrong — see finding 1.

## Findings

### 1. A workspace's linked Linear projects have no writer left — capability lost

**Closed.** The host owns the picker now: Settings → the workspace's page → *Linked provider projects*
(`client-core/settings/WorkspaceExternalProjects.tsx`), over a provider-agnostic seam. A provider
declares a `projects` source on its connection contribution and core serves it at
`GET /v2/core/integrations/:id/projects`, inside the secret scope and the request budget, per
connection. Linear's old `/v2/p/linear/projects` fetch moved onto that source and the route is gone;
Rollbar declared one too, from the connection row rather than the network, which closed the same silent
unscoping on its rail. `supportsProjects` on the public descriptor is derived from the source in both
the projection and the registry's descriptor check, so a provider cannot advertise projects it lacks.

The mirrored-resource route was evaluated first and rejected on inspection, which was the more useful
finding of the two: `MirroredResourceContribution` is not a generic cached provider read, it is the
external-item mirror. Its context hands the provider `ExternalItemStore` and nothing else, `Cached<T>`'s
`fetchedAt` can only come from an item row or a sync marker, and `serveThenRevalidate` re-reads the store
after a refresh — a refresh that writes nothing is a `sync_empty` 502. A project list could only travel
that path by being written into `issues`, the table behind task links, agent context sections,
cross-connection identifier resolution and the storage-footprint count. The caching it would have
inherited is also caching this data does not want: the deleted picker reached *past* its own cache by
hand, because an empty state must be a claim about the provider now.

The fallback in finding 1's mitigation was kept — see the paragraph at the end of this section.

The original finding follows.

The browse carried a picker: *choose which Linear projects this workspace follows*, saved with
`PUT /v2/core/workspaces/:id/external-projects`. It was the **only** writer of
`workspace_external_projects` in the app. It cannot come back on this tier:

- The frame bridge's route table maps `GET` on that path (`core.workspaces:read`) and nothing else,
  under a rule stated at length in `frames/scopes.ts`: every workspace mutation is unmappable,
  because a workspace is the top-level unit a user organises by hand.
- `CoreServices.projects` has no external-project write at all, so a plugin node route cannot do it
  either. `externalProjects` is a read, deliberately scoped to plugin-owned providers.

So the rail would be empty forever on a fresh install. Rather than ship a dead surface, the rail
**falls back to the viewer's own open issues** when the workspace has no Linear projects mapped, and
uses the mapping when there is one. Existing users keep exactly what they had.

That is a mitigation, not a fix. The real answer is a host-owned surface for provider↔workspace
project mappings — the data is core's, the route is core's, and a picker belongs next to
`WorkspaceProjectAssignments` rather than inside whichever plugin happens to own the provider. That
is a deliberate host decision and was left undecided rather than smuggled in behind a migration.

**The fallback stayed, now on purpose.** With a real picker in place the honest-looking alternative is
an empty rail carrying a "link some projects" affordance — and a descriptor rail cannot draw one.
`ChromeSourcePanel` renders every source's empty state as a fixed "Nothing here yet.", with no way for a
contribution to say what is missing or where to go. Dropping the fallback would trade "shows your own
open issues, unlabelled" for "shows nothing, unexplained", which is worse. Making it the right trade
means giving `PluginSourceDescriptor` an authored empty state: a decision about the rail contract, owed
by every source rather than by Linear, and left for whoever takes that on.

The picker landed beside the workspace's identity and project settings rather than beside
`WorkspaceProjectAssignments` as this note guessed. The `workspace` settings group has exactly one page
and it already answers "what is in this workspace"; which external projects it follows is the same
question at the same scope, and the workspace is already in that page's context.

### 2. The content-link grammar is exact-arity, so Linear needs two entries for one URL

`compileContentLinkPattern` matches host and path segments literally, one capture per segment, and
rejects a candidate whose segment count differs. There is no tail wildcard — correctly, since the
whole point is that no manifest string can backtrack the renderer. But Linear's own "copy link" gives
`https://linear.app/acme/issue/ENG-42/some-title-slug`, and the bare
`https://linear.app/acme/issue/ENG-42` also exists, so the manifest declares both arities:
`linear.issue` and `linear.issue-slug`. The compiled regex had been a prefix match and covered both
without anyone thinking about it; one manifest entry would have silently recognised only the rarer
form.

Two consequences fall out of the same bounded grammar and were absorbed in the plugin rather than
worked around:

- **A capture is a path segment, not a typed id.** The old recogniser validated the `ENG-42` shape and
  upper-cased it. The grammar can do neither, so `linear.app/acme/issue/not-an-id` now opens the pane
  and shows "not found", and the frame canonicalises the case itself before asking the route (whose
  identifier filter only accepts the upper-case form).
- **`kind` is the contribution id.** A descriptor target's `kind` is forced to the descriptor's id, so
  it became `linear.issue` where the compiled recogniser returned `linear`. github's PR-detail handler
  narrowed on `kind === 'linear'` to open the side panel when there is no active task; it now narrows
  on the pane the target names, which is stable across both tiers.

### 3. A `refPanel` frame could not draw its own chrome, or close itself

Two independent problems, one fix, and neither is visible from a manifest:

- **A frame cannot `Portal`.** The compiled panel drew a right-anchored drawer over a backdrop by
  portalling out of github's PR conversation. An iframe renders where its consumer puts it, so
  `position: fixed` inside the frame positions against the frame, and the panel came out as a
  letterbox in the middle of the page.
- **`onClose` was unreachable.** `register.tsx` passes it into `PluginFrame`, which maps it to the
  bridge's `importer.close` verb — and the broker gates that verb to importer surfaces, deliberately.
  A refPanel frame therefore had a close callback it had no way to invoke.

So the manifest adapter now draws the overlay and the dismiss control itself, with the same classes a
first-party panel uses, and the frame supplies only the body. That is the same split the importer
surface already had (`the shell still owns the modal chrome`); it was simply never applied to the one
frame target whose consumer does not supply a box.

Also confirmed by reading rather than trusting the brief: `onContentClick` and the multi-ref
`refs`/`onSelectRef` chip strip genuinely do not cross, and genuinely do not matter. The frame handles
clicks inside its own document — a `linear.app` link in a description re-points the view in place, which
is better than what the compiled panel did — and a task linking several tickets gets its switcher from
the task read the pane frame already makes.

### 4. The item store had to cross, and it is the shape `resource()` cannot express

`PluginProviderRuntime` gained `items(providerId)`, returning the same external-item store a mirrored
resource already receives. It is needed by exactly one route and for exactly one reason: the batch
enrichment behind github's PR list reads *the same identifiers across every connection of the
provider*, because a bare `ENG-42` has not been attributed to a workspace yet, so there is no
`connectionId` to key a `resource()` call on. Without it, that route has no local cache and calls
Linear on every PR open — a latency and rate-limit regression on the highest-traffic surface linear
touches, dressed up as a simplification.

It widens what a plugin can reach by nothing: those are its own provider's rows, which its own
resource already writes, and the host binds both the owner and the ownership check.

The **detail** route went the other way and got smaller. Its unscoped branch used to hand-roll a cache
read across connections and then fan out a second time to resolve; it now asks each connection's
mirrored resource in turn and takes the first that answers. The loop is the resolution and the
resource is the cache.

### 5. A frame cannot open a URL, and cannot load a remote image

The frame CSP is `default-src 'none'` with `img-src 'self' data:`, and the iframe sandbox has no
`allow-popups`. So in a ticket rendered inside a frame:

- **Remote images do not load.** A Linear description with an uploaded screenshot shows a broken
  image. Nothing to be done from the plugin side, and punching a hole for `uploads.linear.app` would
  be an odd first exception.
- **External links are inert.** `target="_blank"` cannot open a tab, and there is no bridge verb for
  "open this in the browser" — `openUrl` is a *descriptor* verb the host executes, not something a
  frame can ask for. The affordances are `Copy link` buttons using `bridge.ui.copy`, which is honest
  but worse than the "Open in Linear ↗" anchor it replaces.

A bridge `ui.openUrl` restricted to `https://` would close the second one and would be the same
decision `openUrl` already made for descriptors. Not taken here, because it is a bridge-surface
addition and this was a migration.

### 6. A pane frame cannot say "only when this task links one of my items"

The compiled pane carried `when: (task) => task.links.some((link) => link.providerId === 'linear')`, so
Linear appeared in a task's pane switcher only for a task that had a ticket. A manifest frame surface has
no `when` at all — the only gate is "is this plugin running on this node" — so the pane is now offered on
every task and shows an empty state instead of being absent.

Rollbar's pane is the same shape, so this is the tier's behaviour rather than something linear did wrong,
and it is the reason `docs/panes.md` no longer claims a provider pane appears only when the task has
relevant data. It is also the least bad of the available answers: an empty state that says "pick an issue
from the Linear rail" is more discoverable than a pane that silently is not there. A `when` on a frame
surface would need a descriptor vocabulary for task predicates, which is a bigger thing than this pane
needs.

### 7. `renderMarkdown` needed to be frame-safe

The one thing a frame could not reimplement. It is 80 lines of HTML sanitisation, and re-writing it
per plugin is how a plugin tier gets an XSS. It was only on `@acorn/plugin-api/client`, whose barrel
drags the router, the query client and the API client — none of which a frame may have. It is now also
on `@acorn/plugin-api/ui`, where it qualifies on that barrel's own terms: no imports, no DOM, text in
and markup out.

Everything else the compiled panel imported from the shell — `formatRelativeTime`, the task-link
filter, date formatting — is a few lines each and was reimplemented in the frame rather than widening
the surface.

## What was NOT needed

The useful half of the record, since a verb or scope nothing used is evidence for deleting surface.

- **No `secrets` grant.** The brief expected `secrets: true` "because the provider spends the owner's
  Linear token", and it does — but never through `ctx.core.secrets`. Core resolves the `integrations`
  row inside its own secret scope and lends the key to `withConnections` or to a mirrored resource for
  the length of the call. `true` would have been a grant with no call site and a disclosure that
  overstates. Rollbar declares `secrets: true` and appears not to need it either; worth a look.
- **No task WRITE scope, on either half.** Creating a task and linking the issue stay in the
  host-owned promotion flow, which the rail row feeds with a seed. `api` is one scope,
  `core.tasks:read`, for the pane's "which tickets does this task link" read; the ref-panel frame
  needs none of it.
- **No `tasks`, `prefs`, `fs`, `git`, `models` or `identity` core facet, no `exec`, no capabilities, no
  events, no storage, no migrations.** `projects:read` is the whole node grant, for two methods.
- **No `bridge.state`.** The compiled plugin kept no persisted state and neither does the frame.
- **No `refresh` on the source descriptor.** The invalidation ping covers it, and the browse it
  replaced fetched once per mount anyway.
- **No `slots`, `attention`, `nodeStats`, `agentContexts` or `palette` descriptor**, and no `webview`
  or `settings` frame. The two frame targets and one source descriptor were the whole client surface.

## What the descriptor tier could not express, and was accepted

Beyond finding 1, the browse lost its **triage filters** (search, assignee, label), its **workflow-state
grouping**, and the **facet lists** that fed the selects. The rail is a flat host-drawn list. Ordering
survived and moved to the node — priority first, recency within a priority — because a list still needs
an order; `filterLinearIssues`, `groupLinearIssuesByState` and `linearFacets` lost their only caller and
were deleted with their tests rather than kept as dead code.

That is the same trade rollbar made and the same answer: move exploration into the frame if it is worth
having, rather than growing the descriptor vocabulary until it is a UI framework.

## What was verified, and how

There is no e2e spec for this migration, deliberately: the desktop e2e suite is being extracted from this
repo, so a spec added here would not be runnable where it ends up.

What follows was observed in the real desktop app during the migration, through a throwaway harness that
faked `api.linear.app` and was not kept. It is evidence, not a regression guard — nothing in the repo
re-checks any of it, which matters because the repo's vitest suites are node-environment with no Solid
transform, so no component renders in them at all.

- The trust prompt names `linear`, and shows `Read tasks` (enforced) and `Reach api.linear.app` plus
  `Read projects…` (declared). No credential line, which is what `secrets: false` looks like.
- The rail source draws two rows through the shell's own `.ui-row`, urgent above low, with the node doing
  the ordering and the subtitle reading `ENG-42 · In Progress · Ada · Urgent`.
- `+TASK` opens the host's modal with the title AND the branch prefilled from the row, and creates a task
  with origin `linear` and the `ENG-42` link.
- The pane frame loads at `app-plugin://<64-hex>/index.html`, reads the task's links through
  `core.tasks:read`, and renders the ticket: heading, identifier, the fact grid, the branch, and sanitised
  markdown. Posting a comment over the bridge lands and the detail re-reads.

Two things had to change in `rollbarLoaded.spec.ts` for it to keep passing, both caused by linear joining
the bundled roster rather than by anything in the plugin: a fresh data root now raises a prompt per bundle,
so a spec that answers the first one is not necessarily answering its own; and the extra prompt shifts the
timing enough that the shell's persisted, still-fresh empty task list outlives the point where the spec
seeds a task.

## Still owed
## Still owed

- **The reference panel inside a GitHub pull request.** The highest-risk surface, and the one nothing has
  exercised: it needs a mirrored pull request whose body cites a ticket. It cannot be unit tested either,
  because vitest here cannot render a component. Finding 3 was reached by reading `frames/register.tsx` and
  `frames/broker.ts`, and the fix follows from what they say rather than from having watched it work.
- **A real-token soak.** Everything above ran against a fake `api.linear.app`.
- **Both appearance axes in the frame.** The frame's CSS is written entirely against tokens with
  fallbacks and the bridge pushes the full projection, but no run has switched theme or style with the
  pane open.
- **A `linear.app` URL pasted into a note.** The recognisers parse (unit-covered through
  `linearIdentifierFromHref`, and the manifest's patterns compile through the host's own grammar at parse
  time), but the click path from a note body to the pane has not been driven.
- **A manual pass over the project-mapping surface** from finding 1. The seam, the bounding and both
  providers' sources are unit-covered, but the picker is a component and vitest here cannot render one:
  ticking a real Linear project and watching the row land, the failing-connection row, and both
  appearance axes over it have not been driven.
- **A decision on `ui.openUrl`** from finding 5.
