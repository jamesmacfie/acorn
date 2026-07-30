# GitHub Client and UI

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-GH`

## Contribution set

| Contribution | Placement | Renderer/capability |
| --- | --- | --- |
| `github.source` | workspace source/default source | list/tree/detail primitives |
| `github.browse` | route with Reviews, Navigator, Diff columns | shell layout + `acorn.diff-review/2` |
| `github.pull-task` | task pane, order 10, default `meta+shift+r` when task has PR link | detail + diff |
| `github.create-pull` | source route/dialog | forms + compare diff |
| `github.checks` | PR detail sheet/panel | status/list/log stream |
| `github.settings` | Settings connection page | standard connection wizard/forms |
| `github.pull-context` | Agent context section | immutable PR/review snapshot |
| `github.promote-pull` | source promotion | task creation/link saga |
| commands/keybindings | palette and shortcut settings | host commands/intents |

`CUR-GH-050` GitHub remains the default workspace source on fresh install. When unconfigured, the
source renders a connection call-to-action rather than forcing Acorn login or hiding the shell.

`CUR-GH-051` Browse mode preserves the desktop three-column layout: Reviews list on the left,
Navigator in the middle, and Diff on the right. No selected PR shows the existing branded empty
middle/right state.

`CUR-GH-052` Task mode contributes the two-column PR review pane, Navigator then Diff, only when the
task has an authorized GitHub pull link. Minimum width remains 520 px and the default shortcut is
`Cmd+Shift+R`.

## Repository and pull browsing

`CUR-GH-053` The repository selector shows repositories scoped to the active Node/workspace and
connection, supports pins/order, privacy and stale/offline indicators, and disables repository
switching while a task's repository is fixed.

`CUR-GH-054` Reviews list supports open pulls ordered by update time, on-demand paged closed pulls,
loading/empty/stale/offline/error states, author/draft/state/merge indicators, current selection,
refresh, prefetch of likely next items, and task promotion/opening.

`CUR-GH-055` Keyboard parity includes PR-list next/previous behavior, `c` create pull, `/` file
finder, `[`/`]` previous/next changed file, `?` shortcut settings, and `Cmd+0` opening the GitHub
source. Conflicts leave the command discoverable and unbound according to host policy.

`CUR-GH-056` The file finder is a host overlay with fuzzy path matching, directory/basename
semantics, stable file order, keyboard selection, empty state, and PR-scoped transient state.

## Navigator and review controls

`CUR-GH-057` Navigator renders title/body, author, state/draft, labels, base/head refs, commits,
review summary, requested reviewers, conversation, inline thread summary, mergeability, merge-state,
auto-merge, checks, and refresh freshness.

`CUR-GH-058` It provides host-confirmed commands for merge method, auto-merge enable/disable,
close/reopen, draft/ready, discussion comment, label add/remove, reviewer add/remove, review submit,
inline reply/resolve, check rerun, and open GitHub externally.

`CUR-GH-059` Merge and other destructive/external mutations show the target Node, account,
repository, PR number/title, selected method/effect, stale-head warning where relevant, and provider
outcome. Client optimistic state rolls back on rejection and never substitutes for Node commit.

`CUR-GH-060` Mention autocomplete uses only the authorized mirror's distinct participants and
returns no suggestions when unavailable. Mention text is ordinary Markdown input and cannot select
an account or grant permission.

## Diff and create-pull views

`CUR-GH-061` GitHub supplies the semantic review document; Electron renders it with
`acorn.diff-review/2`. Required parity is stacked files, unified/split modes, virtualized rows,
syntax highlighting, intra-line changes, binary/no-patch state, file headers/stats/viewed state,
hidden-context expansion, thread interleaving, and file navigation.

`CUR-GH-062` Diff hydration prioritizes the route-selected and visible files, processes in bounded
batches, yields between files, cancels stale generations, shows per-file loading/error/retry, and
avoids reparsing on thread-only updates.

`CUR-GH-063` Patches over 120,000 characters or 2,000 lines skip syntax highlighting. Files without
a patch show “No diff (binary or too large).” Missing renderer capability shows file summaries and
bounded patch text, never a blank pane.

`CUR-GH-064` Hidden context fetches an authorized immutable blob by SHA on demand. Expansion
preserves old/new line numbering and inline thread anchors and cannot request an arbitrary
repository/path.

`CUR-GH-065` Inline review composition binds pull head SHA, canonical path, side and line/range;
stale anchors are shown and require refresh/relocation. Unsent composer text is Client session state,
not a committed review.

`CUR-GH-066` Create pull preserves branch selectors, newest-first filtering, base/head comparison,
commit-derived title assistance, title/body/draft fields, zero-ahead validation, file/commit
preview, provider validation detail, and navigation to the created PR.

## Checks and logs

`CUR-GH-067` Checks show name, status/conclusion, provider URL and associated workflow run. Opening a
run loads its jobs and steps; opening a job streams bounded plain text through the sanitized log
renderer with loading, unavailable, expired-link, and retry states.

`CUR-GH-068` Rerun failed jobs is a host-confirmed external mutation and remains pending/stale until
GitHub refresh reports actual state. Provider URLs open only through safe external navigation.

## Fleet, persistence, fallback, and accessibility

`CUR-GH-069` GitHub resources from different Nodes or connections are never merged by owner/name
alone. Search/list labels include Node/account when collision is possible; every navigation intent
retains the canonical resource URI.

`CUR-GH-070` Client persistence may store filters, unified/split preference, file selection, review
scroll, and source navigation per Node/connection/repository/pull. It MUST NOT persist credentials,
private body content outside authorized cache policy, job logs, signed URLs, or unsent review text
beyond the local session policy.

`CUR-GH-071` Connection-revoked, scope-missing, SSO-required, rate-limited, provider-offline,
repository-not-found, stale mirror, no-checkout conflict detail, unsupported renderer, and Node
offline states have distinct text and recovery actions.

`CUR-GH-072` Without GitHub write grants, all mirror-backed review UI remains read-only and write
controls remain visibly disabled with permission rationale. Without `acorn.diff-review/2`, Navigator
and file/patch fallback remain usable.

`CUR-GH-073` Future mobile fallback includes repository/PR lists, Navigator, conversation, checks
summary, bounded patch text, comments/review/approval actions allowed by policy, and explicit
unsupported states for full virtualized diff/log workflows.

`CUR-GH-074` All interactive review functions are keyboard reachable with visible focus, accessible
names, correct dialog focus return, headings/landmarks, and state text. Add/delete/check states do
not rely on color alone.

`CUR-GH-075` Provider body, diff, log, path, label, user, and error text are encoded/sanitized.
Images do not load remotely without host media policy; arbitrary HTML, CSS, script, `javascript:`,
file URLs, and terminal escapes cannot enter the shell.

`CUR-GH-076` Refresh indicates list versus current PR scope, disables duplicate invocation, retains
stale readable data on recoverable failure, and announces the resulting freshness without moving
focus.

`CUR-GH-077` Plugin/client update, disablement, failure, or Node disconnect preserves task pane/source
identity as an unavailable placeholder so layout and deep links restore after recovery.

`CUR-GH-078` GitHub connection setup, scope expansion, account replacement, disconnect, and cache
purge use host settings/wizards. A bespoke or provider-rendered page cannot capture the credential
or imitate an Acorn permission prompt.

`CUR-GH-079` UI conformance covers empty/open/closed/draft/merged/conflicting PRs, no/large/binary
diffs, truncated collections, stale/offline data, all mutations, optimistic rollback, check logs,
connection failures, multi-Node collisions, missing renderers, and screen-reader/keyboard use.
