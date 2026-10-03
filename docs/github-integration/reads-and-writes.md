# Reads and writes

This page covers how GitHub reads reach the editor and the pull request views, how writes keep the
mirror honest, the `github_pull_create` agent tool, and branch adoption after an agent turn.

## Reads and writes

Editor pull-request markers resolve the authorized task root and user-scoped mirror on every read.
Overlapping reads share only active PR-head, base-ref, and merge-base resolution with matching root,
user, mirror repository, pull number, base ref, and head SHA. The wave is removed on success or failure;
a subsequent request resolves mutable refs again. Each file runs its own PR diff and fresh
PR-head-to-worktree translation. Remote base refs precede local refs, the resolved head must match
the mirror's exact SHA, and missing refs produce no PR contribution. Diff failures do not publish
untranslated ranges. Literal pathspecs and disabled external diff and text conversion preserve file
and line identity. [Editor marker custody](../editor/line-markers.md#line-provenance-markers) owns disk/body matching.

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
([agent tools](../agent-tools.md) § GitHub).

The "my pull requests" collection filters by involvement (review-requested, assigned, authored) as a
live GitHub search rather than a mirror query. Assignees are never mirrored, and review requests only
mirror through the PR-detail sync, which runs only for PRs already in the mirror because this account
opened them. A mirror-side filter would parse and render, then answer nothing for the question the
person is asking. Each involvement value runs as its own search and the results are unioned, because
GitHub's search qualifiers only AND, and "assigned to me or waiting on my review" is two questions
however it is asked.
