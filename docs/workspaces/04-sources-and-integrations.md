# 04 — Sources as entry points

A **Source** is a browse surface that produces Workspaces. GitHub, Linear, and Rollbar are all
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
  toWorkspace: (item) => WorkspaceSeed // { origin, repoOwner, repoName, branch, pullNumber?, links[] }
}
```

`WorkspaceSeed` is exactly the non-derived columns of the `workspaces` row plus initial
`workspace_links` (see [`03-data-model.md`](./03-data-model.md)). Workspace creation is one code
path regardless of which Source produced the seed — that uniformity is the whole value.

## Which Sources appear
The **Sources** zone of the rail is driven by connected integrations, the way the terminal already
gates agent profiles by PATH availability (`TerminalProfile.available`, `shared/terminal.ts:40`).

- **GitHub** — always available (it's the app's reason to exist; the session cookie already carries
  the token).
- **Linear** — appears iff `integrations` has a `linear` row (`schema.ts:232`). Connected via the
  existing `IntegrationsModal` (`features/integrations/IntegrationsModal.tsx`).
- **Rollbar** — appears iff a `rollbar` integration row exists (new; see below).

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
  `issues` table (`provider: 'rollbar'`, `identifier:` the Rollbar item id, `data:` the JSON) — the
  table was built generic for exactly this (`schema.ts:286`).
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
  could collapse into one Workspace's links). Nice, not now.
- Bi-directional sync (commenting on Linear from acorn already exists via `LinearIssuePanel`;
  extending that per-Source is out of scope here).
