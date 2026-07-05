# 04 — Sources as entry points

> **✅ Status: shipped** (read "Workspace" as **Task**). All three Sources exist: gating lives in
> `features/tabs/sources.ts`, browse views are `PullList` (GitHub), `features/tasks/LinearBrowse.tsx`
> and `RollbarBrowse.tsx`, and Rollbar's reads are `server/routes/rollbar.ts` — which cached into
> the generic `issues` table with **zero new schema**, passing the litmus test at the bottom of
> this doc. Divergences from the design as written:
> - **The `Source` record below stayed conceptual.** What shipped is the same contract split
>   across a pure gating function (`availableSources`), per-source browse components, and one task
>   creation path (`TaskSeed` → `POST /api/tasks`) — no literal `Source` object; the uniformity
>   survived, the shape didn't.
> - **`integrations` went multi-row per provider**: opaque `id` PK + `label`, so a user can
>   connect several Linears/Rollbars. Consequently links carry an `integrationId`
>   (`task_links`, née `workspace_links`) and the `issues` cache is keyed
>   `(userId, integrationId, identifier)`.
> - **Promotion-time Linear-id parsing shipped with a caveat**: PR-body refs seed `task_links`
>   only when exactly *one* Linear connection exists (`PullList.tsx` `scanLinearRefs`), because a
>   bare `ENG-42` can't name which connection it belongs to. Multi-connection disambiguation is an
>   open question (below).

GitHub, Linear, and Rollbar are all
Sources. The design goal: adding a new integration should be *mechanical* — provide a browse view
and a way to turn one of its items into a Workspace, and it slots into the rail with no special
casing.

## The Source contract

A Source is two things:

1. **A browse view** — a component that lists the source's items (PRs, tickets, errors) and renders
   in the main area when its rail entry is selected.
2. **A "promote to Workspace" mapping** — given a selected item, produce the fields a new Workspace
   needs.

```ts
// Conceptual — not prescribing the exact module shape yet.
type Source = {
  id: 'github' | 'linear' | 'rollbar'
  label: string
  available: () => boolean            // gated by integrations (see below)
  BrowseView: Component                // the list UI in the main area
  toWorkspace: (item) => TaskSeed      // { origin, repoOwner, repoName, branch, pullNumber?, links[] }
}
```

`TaskSeed` (the shipped type — designed here as `WorkspaceSeed` — in
`apps/desktop/src/shared/api.ts`, consumed by `routes/tasks.ts` `POST /api/tasks`) is exactly the
non-derived columns of the `tasks` row plus initial links (see
[`03-data-model.md`](./03-data-model.md)). Task creation is one code path regardless of which
Source produced the seed — that uniformity is the whole value.

## Which Sources appear
The **Sources** zone of the rail is driven by connected integrations, the way the terminal already
gates agent profiles by PATH availability (`TerminalProfile.available` in `shared/terminal.ts`).
The shipped check is `availableSources()` in `features/tabs/sources.ts`, a pure function over the
integrations list.

- **GitHub** — always available (it's the app's reason to exist; the session cookie already carries
  the token).
- **Linear** — appears iff a connected `linear` integration exists (`availableSources()` tests
  `provider === 'linear' && connected`). Connected via the existing `IntegrationsModal`
  (`features/integrations/IntegrationsModal.tsx`).
- **Rollbar** — appears iff a connected `rollbar` integration exists (same check; new — see below).

## GitHub source
The browse view is essentially today's `PullList` (`features/.../PullList.tsx`), generalized to span
repos rather than being pinned to `useParams()`. `toWorkspace` for a PR:

```
{ origin: 'github-pr',
  repoOwner, repoName,            // from the PR
  branch:   pr.headRef,           // pull_requests.headRef
  pullNumber: pr.number,
  links: [] }                     // Linear ids parsed from the PR body become workspace_links
```

The Linear-id parsing that `PullDetail` does today at render time (`linkifyLinearIds`) moves to
promotion time: any `ENG-42`-style ids found in the PR body seed `workspace_links` rows, so the
Linear pane is populated from the start.

## Linear source
- **Browse view:** a ticket list (assigned to me / a saved view). New, but thin — it reuses the
  existing Linear client behind `linearIssuesOptions` / `linearIssueOptions` (queries).
- **`toWorkspace`:** infer the repo + branch from the ticket's linked branch/PR if Linear has one
  (Linear stores git-branch names on issues); otherwise the promotion prompts for a repo and a new
  branch name. `origin: 'linear'`, and the ticket becomes a `workspace_links` row.
- **The Linear pane** is today's `LinearIssuePanel` (`features/integrations/LinearIssuePanel.tsx`)
  lifted out of its portal into a workspace pane, resolving its issue via the workspace's link.

## Rollbar source (new integration)
Rollbar is the user's example of a *non-PR, non-ticket* origin — "I might have some Rollbar things
I'm looking at." It fits the contract with no new concepts:

- **Connect:** add a `rollbar` provider row to `integrations` (access token, JWE-encrypted at rest
  exactly like Linear — `integrations.accessToken`, `session.ts encryptSecret`). Extend
  `IntegrationsModal` with a Rollbar field.
- **Browse view:** a list of recent error items (Rollbar REST API). Items cache into the generic
  `issues` table (`provider: 'rollbar'`, `identifier:` the item's visible **counter** —
  `String(raw.counter)` in `routes/rollbar.ts`, the number users see in Rollbar URLs, *not* the
  internal item id — `data:` the JSON). The table was built generic for exactly this (`issues` in
  `schema.ts`).
- **`toWorkspace`:** an error rarely knows its repo/branch, so promotion prompts for repo + new
  branch (`origin: 'rollbar'`), attaching the error as a `workspace_links` row. The "Rollbar pane"
  shows the error detail/stacktrace; the user then opens a terminal/agent to fix it.

Rollbar needs **no schema beyond** the `integrations` row and reusing `issues` — both of which are
already part of the fresh P0 baseline ([`06`](./06-implementation-phases.md)), so adding Rollbar is
pure feature code. That's the litmus test that the Source abstraction holds.

## Why this matters
Today every integration is bespoke: Linear is hardcoded into `PullDetail`. The Source contract makes
"the thing you start from" pluggable, which is what lets the user's varied entry points
(PR / ticket / error / local) all converge on the same Workspace. The cost is one indirection
(`Source.toWorkspace`); the payoff is that the next integration is additive, not invasive.

## Deferred
- Cross-source dedup (a PR, its Linear ticket, and a Rollbar error that are all *the same work*
  could collapse into one Workspace's links). Nice, not now. *(Still not built.)*
- Bi-directional sync (commenting on Linear from acorn already exists via `LinearIssuePanel`;
  extending that per-Source is out of scope here). *(Still not built.)*

## Open questions (post-ship)
- **Multi-connection link disambiguation.** With several Linear connections, promotion-time
  parsing currently skips seeding links entirely (see the status note). Options: prompt at
  promotion, try each connection's API until the identifier resolves, or a per-repo default
  connection. Not decided — today the user adds the link by hand in the Linear pane.
- **Should Sources be data-driven after all?** Three hardcoded `SourceId`s (`'github' | 'linear' |
  'rollbar'` in `features/tasks/tasks.ts`) are fine at N=3; if a fourth integration lands, revisit
  whether the conceptual `Source` record should become real to avoid touching the rail, the
  palette, and `sources.ts` each time.
