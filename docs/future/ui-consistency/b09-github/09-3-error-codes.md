# 09-3. A failed GitHub action prints the server's error code

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

When a route fails without a detail, the node puts the code in the message, and the PR model shows it
as-is. A failed merge reads **merge_failed**; an expired token reads **reauth**. A failed reply or
resolve in the diff reads "failed". The one moment a person needs a plain sentence is when their merge
did not happen.

## Where to see it

From code: the overview's error line and a diff thread's reply. With the seed's fake token, any write
action fails, but do not press **Merge** against a real repository.

## The fix

- `plugins/github/src/client/pullDetail/prModel.ts:161-170, 276-277`: a code-to-sentence table, used
  before `setActionError`. Replace the text only when the message equals the code, and keep the code
  for the log. Read the code as `(cause as { code?: string }).code`.
- `reauth` gets a **Reconnect GitHub** action in the alert.
- `plugins/github/src/client/DiffForPull.tsx:105-106`: the `reply` and `resolveThread`
  wrappers catch and rethrow with a sentence: "Couldn't save your reply." and "Couldn't resolve the
  thread."

## Copy

| Code | Current text | Decision | New text |
| --- | --- | --- | --- |
| `merge_failed` | merge_failed | Rewrite | GitHub wouldn't merge this pull request. Check its reviews and checks. |
| `reauth` | reauth | Rewrite | GitHub turned down acorn's sign-in. Reconnect GitHub. (with a **Reconnect GitHub** button) |
| `auto_merge_not_allowed` | auto_merge_not_allowed | Rewrite | This repository doesn't allow auto-merge. |
| `node_id_unknown`, `head_sha_unknown` | (the code) | Rewrite | acorn hasn't finished loading this pull request. Refresh it and try again. |
| `rate_limited` | rate_limited | Rewrite | GitHub is limiting requests. Try again in a minute. |
| `forbidden` | forbidden | Rewrite | Your GitHub account can't do that on this repository. |
| `sso` | sso | Rewrite | GitHub needs you to authorise this token for your organisation's single sign-on. |
| `github_unavailable` | github_unavailable | Rewrite | GitHub didn't answer. Try again. |
| any other code | (the code) | Rewrite | GitHub didn't accept that. Try again. |
| reply in the diff | failed | Rewrite | Couldn't save your reply. |
| resolve in the diff | failed | Rewrite | Couldn't resolve the thread. |

The plan's overrules: the `reauth` sentence drops "in Settings", because the alert has a button; `sso`
gets its own sentence; a default covers the codes the table misses. The kit's own fallback for a failed
save is "Couldn't save. Try again." (B08a, 08-16 (shipped in B08a));
GitHub's wrappers say what failed instead.

## Risk and checks

- Before you start, list the codes each action route can return (`prActions.ts`, `githubApi.ts`).
- Any plugin that shows `error.message` from a route without detail has this problem. Note any you find.
- Tests: `plugins/github` (a model test per code family).
