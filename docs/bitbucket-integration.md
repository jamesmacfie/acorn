# Bitbucket integration

This page covers the Bitbucket plugin: connecting Bitbucket Cloud, importing repositories, and working
pull requests as tasks. Read it before you change `plugins/bitbucket/`. The plugin is a code host
([code hosts](./plugins/code-hosts.md)) for bitbucket.org, built on the seams the GitHub and GitLab
plugins use, and it draws its review views from the [shared review views](./plugins/change-request-ui.md).
Bitbucket Data Center and Server aren't supported.

## Connecting

The provider is `bitbucket`, in `plugins/bitbucket/src/server/provider.ts`. A person enters their
Atlassian email and an API token in Settings. The connection stores both as one secret,
`email:token`, and every call sends it as basic auth. One connection per Node.

The token needs these Bitbucket scopes: `read:user`, `read:workspace`, `read:repository`,
`read:pullrequest`, `write:pullrequest`, and `read:pipeline`. Validation reads `/2.0/user`. A refused
token fails with Bitbucket's own message, which the connect form shows.

OAuth isn't offered. Its token exchange needs a client secret, and a secret inside a shipped binary
can be recovered. Bitbucket stopped issuing app passwords in September 2025, so the plugin doesn't
take one.

`createBitbucketAccount` in `plugins/bitbucket/src/server/account.ts` holds the connection's id in
memory, read at init and on every `connection:changed` for `bitbucket`. The mirror is keyed by it, and
a disconnect or a different account drops the other connection's rows.

## The mirror

The mirror is the plugin's own SQLite file (`plugins/bitbucket/src/node/schema.ts`), keyed by
connection and by each repository's full name, lowercased:

| Table | Holds |
| --- | --- |
| `repositories` | The repositories the person is a member of |
| `pull_requests` | The open list, and each pull request's detail once it's read |
| `pr_files` | Changed files, with each patch's digest in the blob cache |
| `participants`, `comments`, `commits`, `statuses` | Reviewers and verdicts, comments, commits, and build statuses |
| `sync_state` | When each resource was read, and the revision a diff was cut at |

Bitbucket's REST API keeps each part of a pull request apart, so the mirror reads it lazily
(`plugins/bitbucket/src/server/mirror/detail.ts`):

- The open list is one request per 50 pull requests. A row carries no statuses, participants, or
  comments.
- A pull request's detail is four requests, sent together: the pull request with its participants,
  its comments, its commits, and its build statuses.
- Its files are two: the diffstat, and one unified diff that the mirror splits by file.

Detail is read only when someone opens a pull request, a task links it, or a workflow gate asks. A
reader is served the mirror inside 45 seconds and served it stale while a refresh runs after that.

On a cold mirror, a list of 100 open pull requests takes three requests: one for the repository and two
pages. A second read inside the window takes none (`repositoryRoutes.test.ts`, measured against the
fake on October 17, 2026). Bitbucket allows about 1,000 API requests an hour for an account. When a
refresh fails, such as on that limit, the list answers its last copy with the time it was read, and
says so once the copy is more than five minutes old.

## Pull requests as tasks

The code host declaration in `plugins/bitbucket/src/node/index.ts` claims `bitbucket.org`, declares no
`ref`, names a pull request with `#`, and opens the `bitbucket-pr` pane. Pane ids are global, and `pr`
is GitHub's.

Bitbucket publishes no ref for a pull request. A task carries the pull request's source branch, and
for a pull request from a fork, the fork's full name as `sourceRepository`, so core fetches the branch
from the fork ([forks without a ref](./plugins/code-hosts.md#forks-without-a-ref)). The list's
**Create task**, the reference panel, the browser button, and adoption on a branch all pass both.

Core's agent tools read the pull request through `/v1/p/bitbucket/change-requests`. The workflow names
`checks-green`, `ci-loop`, and `review-received` ask `bitbucket:ci-settled` and
`bitbucket:review-received` (`plugins/bitbucket/src/server/workflowPolicies.ts`). Each poll reads the
pull request again, which is four requests at the policies' 30-second floor.

Bitbucket's words map onto the shared model in `plugins/bitbucket/src/server/mirror/vocabulary.ts`:

- A pull request that's declined or superseded is `closed`.
- A build status that's `SUCCESSFUL`, `FAILED`, `INPROGRESS`, or `STOPPED` is `success`, `failure`,
  `in_progress`, or `cancelled`.
- A participant who approved or asked for changes is a review with that verdict.
- A comment with an `inline` location starts a thread, placed on the new side by `to` and on the old
  side by `from`. Its replies join it, and its resolution is the thread's.

Only the build statuses on the head commit are checks. The pull request names its head by a short hash,
so the mirror takes the full hash from the commit list. `ci-settled` waits while the statuses it holds
are all for an older commit.

## Addresses and routes

A repository is named by its full name, such as `acme/api`, and a pull request is `acme/api#12`, in
task links, source rows, and the reference panel. `plugins/bitbucket/src/shared/pullRequestRef.ts`
builds and parses both. The repository routes are `/v1/p/bitbucket/repositories/:workspace/:repo/...`.
The browser button matches `https://bitbucket.org/{workspace}/{repo}/pull-requests/{number}`, with or
without a tab after it.

## The client

The `bitbucket` rail source lists a repository's pull requests and draws one, and the `bitbucket-pr`
pane draws a task's, both from the shared views (`plugins/bitbucket/src/client/`). The pane's chord is
⌘⇧K. **Open pull request** under the Changes tab opens bitbucket.org's own form for the branch. The
importer lists the person's repositories, with **Clone** and **Link folder**.

The review offers a comment, **Approve**, and **Request changes**. Merging offers a merge commit,
squash, or fast-forward. Reviewers come from the workspace's members, and the plugin writes the whole
reviewer list back by each person's uuid. A person is named by their Bitbucket nickname.

The plugin opens `bitbucket:diff-line` and `bitbucket:summary-badges`, and registers the data sources
`pull-requests` and `pipeline-steps`. The pull request source reads every state of each selected
repository's pull requests, with the author and reviewers, so a panel filters to a person's own or to
the ones they review. The step source reads the steps of each repository's five newest pipelines.

## Limits

- One account per Node. Bitbucket Data Center and Server aren't supported.
- No labels, draft toggle, or reopening a declined pull request, so those controls aren't drawn.
- A build status has no log in acorn, and no step re-runs, because Bitbucket re-runs a whole
  pipeline or its failed steps, never one step.
- No batched review or suggested changes. Each comment posts on its own.
- No team reviewers. Bitbucket's default reviewers are people.
- Expanding a hunk's context on a fork's pull request reads the file from the base repository, which
  may not have the fork's head commit.
- The browser button's anchors aren't checked against bitbucket.org's markup. When none matches, the
  extension's sidebar still offers it.
- Verified against a fake Bitbucket API (`plugins/bitbucket/src/server/fakeBitbucket.helper.ts`). A
  check against a real account needs a person with a bitbucket.org workspace.
