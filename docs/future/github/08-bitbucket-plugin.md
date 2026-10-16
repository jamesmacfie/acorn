# Phase 8: build a Bitbucket Cloud plugin

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
