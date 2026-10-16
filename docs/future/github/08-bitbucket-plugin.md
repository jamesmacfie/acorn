# Phase 8: build a Bitbucket Cloud plugin

## Completion note

October 17, 2026. Done, verified against a fake Bitbucket API only.

What landed:

- `plugins/bitbucket/`, a compiled plugin registered on the Node, the desktop, and the terminal client,
  with one migration, `0000`. It declares `codeHost` for `bitbucket.org` with no `ref`, label
  `pull request`, prefix `#`, pane `bitbucket-pr`, and the phase 1 `api`. [Bitbucket
  integration](../../bitbucket-integration.md) documents it.
- Sign-in with an Atlassian email and API token, stored as one `email:token` secret and sent as basic
  auth. A wrong token fails at validation with "Bitbucket said: " and Bitbucket's message.
- The mirror, keyed by connection: repositories, pull requests, diffstat and patches, participants with
  their verdicts, comments, commits, and build statuses. The open list is one request per 50 pull
  requests. A pull request's detail is four requests and its files two, read only when someone opens
  it, a task links it, or a workflow gate asks.
- Every task path passes the source branch and, for a fork, the fork's full name lowercased as
  `sourceRepository`: the list's **Create task**, the promote-to-task modal, the browser handoff seed,
  and adoption on a branch.
- The four change request routes, `bitbucket:ci-settled` and `bitbucket:review-received`, the four
  events, the data sources `pull-requests` and `pipeline-steps`, the browser handoff, editor line
  markers, and the client: rail source, browse list and detail, `bitbucket-pr` pane (⌘⇧K), rail marker,
  reference panel, content links, importer, and **Open pull request** push action.
- The desktop's image policy allows Atlassian's avatar host, which Bitbucket's Gravatar links fall back
  to (docs/shell/origins.md).

Shared rather than copied:

- The rail marker's marks moved to `changeRequestMarkers` in `@acorn/change-request-ui/model`, and its
  read, poll, and refresh loop to `changeRequestRailMarker`, a new `@acorn/change-request-ui/railMarker`
  entrypoint. GitLab's `mr` button uses both, and its test moved with them. The entrypoint is its own
  because a client entry imports the marker eagerly, and the views barrel would pull every shared view
  into first paint.
- `addLabel` with `removeLabel`, `reopen`, and `ChangeRequestView`'s `checkPanel` are optional. A host
  without them gets no Labels section, no **Reopen**, and no check panel. GitHub and GitLab pass all
  three, so neither changes.
- The connect form shows a provider's own refusal message ahead of the generic "Those credentials were
  rejected" sentence. No other provider sends one with `provider_needs_auth`, so only Bitbucket's copy
  changes. The client-core test that pinned the old order now pins the new one.

Decisions and deviations:

- No OAuth and no `BITBUCKET_CLIENT_ID`, as the doc decides, so nothing needs registering.
- One connection per Node. The mirror is keyed by it anyway, so a different account never reads the
  last one's private rows, and a disconnect drops them.
- "My pull requests" and "review requested" are fields on the `pull-requests` source, `author` and
  `reviewers`, over the repositories a panel names, not the workspace listing. Bitbucket's workspace
  listing returns only pull requests the user authored, so it can't answer "review requested", and a
  per-repository read answers both from one request shape.
- A person is named by their Bitbucket nickname. A reviewer is added by finding the nickname in the
  workspace's members and writing the whole reviewer list back by uuid, with the title Bitbucket's
  update requires.
- Build statuses have no `runId`, so a check row has no log panel and no re-run. Only statuses on the
  head commit are checks. The pull request names its head by a short hash, so the mirror takes the full
  hash from the commit list, which the editor's line markers also need.
- A review is a comment, **Approve**, or **Request changes**, and a verdict with words posts the comment
  first. Merging offers a merge commit, squash, and fast-forward. **Close** declines.
- No draft toggle. Creation sends `draft`, but the update that would toggle it couldn't be checked
  without a real account.
- The open list answers `{ rows, fetchedAt }`, and the list says how old its copy is past five
  minutes, for when Bitbucket's rate limit stops the refreshes.
- On a cold mirror, 100 open pull requests take three requests: the repository and two pages of 50. A
  second read inside the 45-second window takes none. Counted against the fake on October 17, 2026,
  in `repositoryRoutes.test.ts`.
- The pipeline step source reads the steps of each repository's five newest pipelines, one request for
  the pipelines and one per pipeline, and offers no action.
- The handoff's anchors are a guess at bitbucket.org's markup. The sidebar offers the handoff when none
  matches.
- The Node half loads everything past its declarations on first use. It adds 9,498 B to the service's
  static graph (1,913,616 B against 1,904,118 B with the plugin left out of the composition). The base
  was already over the 1,832,800 B ceiling, so the ceiling isn't raised.
- The desktop renderer's budgets were already over at the base: startup scripts 952,214 B against
  740,000, and the compiled roster 312,712 B against 244,000. Bitbucket adds 104 B and 10,629 B.
- `repositorySource.ts` copies GitLab's `projectSource.ts`, the query filter, sort, and page logic, with
  repositories for projects. A third code host should move it into `@acorn/plugin-api`.

Left open:

- A real-account check needs a person with a bitbucket.org workspace: the token scopes, the handoff
  anchors, `fields=+values.reviewers` on the list, comment resolution, and fork checkout.
- Expanding a hunk's context on a fork's pull request reads the file from the base repository, which
  may not hold the fork's head commit.
- The terminal client draws the plugin through its roster but wasn't checked in the TUI driver.
- Already red at the base and untouched: the `pluginDisable` and `routeRegistry` goldens in `apps/node`
  (the browser-panel and agents MCP routes; both gained only Bitbucket's lines), three `docPaths`
  entries for `dist` files, knip's `proposalChanges`, three site unit tests, the Node service budget,
  and the desktop renderer budgets above.

Date: October 16, 2026. Status: proposed. Depends on phases [1](./01-change-request-agent-context.md)
to [5](./05-gitlab-plugin.md) and [7](./07-fork-checkout.md).

## Goal

A person whose code is on bitbucket.org works pull requests as tasks, with agent context, workflow
gates, the browser button, and review views. Some GitHub features have no Bitbucket equivalent, and
this page says which.

## Starting point

By this phase the core seams are provider-neutral, the review views are shared, and the GitLab plugin
is a second worked example. Bitbucket Cloud differs from both in ways that cost more than GitLab did:

| GitHub plugin | Bitbucket Cloud | Gap |
| --- | --- | --- |
| Device-flow connect | No device flow. OAuth needs a client secret | Sign in with an API token |
| `pull/{number}/head` | No pull request ref | [Phase 7](./07-fork-checkout.md) fetches the fork's branch |
| GraphQL search with nested checks and reviews | REST only, paginated per resource | Several requests per pull request, and lower rate limits |
| Checks | Build statuses on the head commit, and Pipelines | None for reading |
| **Re-run job** | Pipelines re-run a whole pipeline or its failed steps | No single-job re-run |
| Review threads on a line and side | Inline comments with a path and a line on either side | No batched review or suggested changes, to be checked against the API |
| Review decision | Approve and request changes per reviewer | None |
| Team review requests | Default reviewers, people only | Leave the team field empty |

## Sign-in

Bitbucket Cloud stopped issuing app passwords in September 2025 and scheduled their removal for
mid-2026, so the API token is the way in. Atlassian's
[announcement of API tokens](https://www.atlassian.com/blog/bitbucket/bitbucket-cloud-transitions-to-api-tokens-enhancing-security-with-app-password-deprecation)
has the timeline. The person creates a scoped API token and enters it with their Atlassian email. The
plugin sends both as basic auth. The connection form's `fields` already support this, as Linear's
API key does.

OAuth isn't offered. Its token exchange needs the client secret, and a secret inside a shipped
binary can be recovered. Doing it safely means a hosted exchange service, which belongs to the
[cloud programme](../cloud/README.md), not here.

## The plugin

Build it in `plugins/bitbucket/` (new folder) as a built-in compiled plugin, like GitLab. Contribute
these:

1. `codeHost` with `hosts: ['bitbucket.org']` and `changeRequest` with no `ref`, label
   `pull request`, prefix `#`, pane `bitbucket-pr`, and the phase 1 `api`. Pane ids are global, and
   `pr` is GitHub's.
2. Attach every pull request with its source branch, and, for a fork, its source repository path, so
   phase 7 can check it out.
3. Its mirror: repositories, pull requests, diffstat, comments, participants with their approval
   state, and build statuses. Use the workspace pull request listing for "my pull requests" and
   "review requested". Fetch details lazily, because each part is a separate request.
4. The phase 1 routes, the phase 2 policies and events, data sources for pull requests and pipeline
   steps, and the client contributions GitLab has, with the shared views.
5. The browser handoff for `https://bitbucket.org/{workspace}/{repo}/pull-requests/{number}`, which
   needs no multi-segment capture.

## Out of scope

Bitbucket Data Center and Server, whose API, auth, and refs differ. Jira links, which belong to an
issue tracker plugin. Pipeline step re-runs, until the Pipelines API offers a single-step retry that
matches **Re-run job**.

## Acceptance

- Connect with an Atlassian email and API token. A wrong token fails at validation with the
  provider's message.
- Open a pull request from the same repository and one from a fork as tasks. Both check out the right
  commit.
- `pr_current`, `pr_checks`, `pr_review_comments`, and `pr_create` answer on those tasks, and
  `checks-green` waits for the build statuses.
- The list of 100 open pull requests stays inside Bitbucket's hourly rate limit on a cold mirror. Count
  the requests with the fake API and write the number down with its date.
- Run every check against a fake Bitbucket API. The real-account check needs a person with a
  bitbucket.org workspace.

## Risks

The rate limit decides how fresh the mirror can be. GitHub's open list refreshes in one search, and
Bitbucket's takes one request per pull request for statuses and participants. Refresh details only for
pull requests someone opened or a task links, and say in the list when a row is older than its
refresh window.
