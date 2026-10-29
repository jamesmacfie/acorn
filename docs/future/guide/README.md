# Review guides: an agent walks you through a pull request

Date: October 30, 2026. Status: proposed. No phase started.

## What this is

A plugin that turns a task's pull request, merge request, or Bitbucket pull request into a guided
review. The person picks an agent harness, such as Claude Code or Codex. The harness reads the change
in the task's worktree and groups its hunks into sections in reading order. Each section says why its
change exists and shows its hunks. Core changes come first, and supporting changes such as tests,
docs, and wiring come after.

This is the shape of Linear's guides ([Linear diffs](https://linear.app/docs/diffs)), Graphite's Code
Tours, Devin Review, and Baz's topics. The difference is that the person chooses the harness, and the
session runs in the task's worktree, where it can read more than the diff.

## How it works

1. A task has a primary change request. Core already checked it out into the task's worktree, for
   every code host ([code hosts](../../plugins/code-hosts.md#change-requests)).
2. The plugin's node half reads the change request's target branch, finds the merge base, and runs
   `git diff` in the worktree. No code host API is involved, so GitHub, GitLab, and Bitbucket work the
   same way.
3. It splits the diff into hunks, each with a stable ID.
4. It runs one turn through `agents.sessionExecute` with the chosen profile, the hunk list as
   context, a JSON schema for the answer, and read-only tools.
5. It checks that every hunk appears in the answer exactly once. Hunks the harness left out go in a
   section marked **Not covered by the guide**, so the guide never hides code.
6. It stores the guide against the base and head commits. A new head commit marks the guide stale.
7. The client draws the guide as a plugin tree, with each hunk in the kit's `StackedDiff`.

## The phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Agent turns for installed plugins](./01-session-execute-for-plugins.md) | A safe, typed `agents.sessionExecute` for loaded plugins, a trust prompt line, and a way to list the profiles a plugin may choose. | Nothing |
| [2. The target branch on a change request](./02-change-request-base.md) | `baseRef` and `headSha` on core's neutral change request detail, filled by all three code hosts, and a task facet method that reads it. | Nothing |
| [3. The review guide plugin](./03-review-guide-plugin.md) | `plugins/review-guide`, a bundled loaded package with its own pane. This is the first version a person can use. | 1 and 2 |
| [4. The guide inside the pull request view](./04-guide-in-change-request-view.md) | A shared extension point in the change request views, so the guide sits beside the diff in all three code hosts. | 3 |
| [5. Jump from a guide step to the code](./05-reveal-in-diff.md) | A bridge operation that scrolls a task's change request diff to a file and line. | 3 |

Phases 1 and 2 are independent and can run in parallel. Phases 4 and 5 are independent of each other.

## Rules no phase may break

| Rule | Why |
| --- | --- |
| Every change is additive. `PLUGIN_API_MAJOR` stays where it is. | Installed plugins keep loading ([AGENTS.md](../../../AGENTS.md)). |
| A loaded plugin never sets `posture` or `allowUnguardedAgents` on a turn. Only the workflows plugin resolves those. | The October 21 review's S4 fix depends on it ([review](../../security/review-2026-10-21.md)). |
| A guide never drops a hunk. Coverage is checked in code, not trusted to the prompt. | A reviewer who trusts a guide doesn't look for what it left out. |
| Generating a guide is something the person starts. A new commit marks a guide stale, and it doesn't regenerate on its own. | Each guide spends harness usage. |
| The plugin reads the diff from the worktree, not from a code host. | One code path for every host, and no new network grants. |

## Not in scope

- Guides for pull requests with no task. `agents.sessionExecute` needs a task, and opening a task for a
  review is already how Acorn reviews a pull request.
- Posting the guide back to the code host as a comment.
- Risk scores, review effort scores, and sequence diagrams.
- Classifying files from `.gitattributes`, the way Linear does. The harness's own judgment covers
  this for the first version.
- Commit-by-commit guides.

## When it ships

Describe the behavior in owning reference pages and remove these files, as
[writing docs](../../writing-docs.md) says. The owners are likely
[session control](../../managed-agents/session-control.md) for phase 1,
[code hosts](../../plugins/code-hosts.md) for phase 2, a new page beside the
[first-party plugins](../../first-party-plugins.md) for phase 3,
[shared review views](../../plugins/change-request-ui.md) for phase 4, and
[frames](../../plugins/frames.md) for phase 5.
