# Hide outdated review comments from the code pane

Date: 2026-10-01

Status: Proposed product requirements. Not implemented.

Owner: GitHub plugin. Applies to task pull requests and the classic pull request browser.

## Problem and outcome

A reviewer comments on code. A later push changes that code, and GitHub marks the thread outdated.
Acorn can still display the comment beneath the same numeric line, even when that line contains
unrelated code. This placement misrepresents the reviewer's intent.

In the supplied example, the reviewer recommends replacing a rotated more-actions icon with
`common/IconThreeDot.tsx`. GitHub labels the thread **Outdated**. Acorn displays it beneath tooltip
properties that occupy the historical line number.

The code pane must hide outdated threads. The pull request conversation must retain their full
history with an **Outdated** label. Hiding a thread changes presentation, without resolving it or
deleting comments.

## Feasibility and evidence

GitHub supplies `PullRequestReviewThread.isOutdated` separately from `isResolved`, `line`, and
`originalLine`. Acorn can preserve those distinctions rather than infer validity from a line number.
See the official [PullRequestReviewThread reference](https://docs.github.com/en/enterprise-cloud%40latest/graphql/reference/pulls#pullrequestreviewthread).

These findings describe the checkout inspected on the date above. Paths are implementation hints
and must be verified before development:

- `plugins/github/src/server/routes/mirror/prFetch.ts` requests `line`, `originalLine`, and
  `isResolved`, but omits `isOutdated`.
- `plugins/github/src/server/routes/mirror/prMirror.ts` stores `line: t.line ?? t.originalLine`.
  This fallback turns a historical location into a supposed current location.
- `plugins/github/src/node/schema.ts` denormalizes thread fields onto each comment row. It has
  no separate outdated status or original line column.
- `plugins/github/src/shared/api.ts` exposes `Thread.line` and `Thread.resolved`, without outdated
  status or historical location.
- `plugins/github/src/client/DiffForPull.tsx` passes detail threads to the shared diff viewer.
  `packages/client-core/src/features/diff/documentView.ts` places them by path, side, and line.
  A numeric match alone cannot establish that a comment concerns the displayed code.
- `plugins/github/src/client/pullDetail/Conversation.tsx` uses the same line to request a snippet
  from the current diff. The defect can therefore misrepresent code in the conversation too.

The data flow is GitHub GraphQL, the Node-owned plugin mirror, plugin detail routes, the broker,
the client query cache, and the GitHub diff adapter or conversation renderer. Provider status
interpretation belongs in the GitHub plugin. The generic viewer should receive eligible inline
threads through its established source contract. No shell or core protocol coupling is required.

## Product requirements

### Review code pane

1. Exclude every thread GitHub marks outdated, even if it also has a non-null current line or that
   line exists in the displayed diff. Hide the entire inline block, composer, and controls.
2. Exclude threads without a current path, supported side, or current line. A missing location
   alone does not justify an **Outdated** label; only the provider status does.
3. Place eligible threads using the provider's current line. Never substitute `originalLine` or
   select a nearby numeric line for historical feedback.
4. Keep valid comments visible when GitHub moves their current location after a push. A change of
   commit or line number alone does not mean the thread is outdated.
5. Apply the same eligibility rule in unified and split views, including deleted-side comments.
6. Remove a visible thread and its reserved layout space when refreshed detail marks it outdated.
   Do not require reopening the pane, switching files, or restarting Acorn.
7. Preserve established behavior for resolved threads with valid current locations. Outdated and
   resolved are independent states.

### Pull request conversation

1. Retain outdated threads, replies, authors, ordering, and identifiers.
2. Show an **Outdated** badge. A resolved outdated thread can show both statuses.
3. Do not request or display a current-diff snippet for an outdated thread. Historical line
   metadata may appear only with an explicit label such as **Original line 275**.
4. Remove **View in diff** for outdated or unlocated threads. Navigation must not imply that a
   historical comment has a valid current inline location.
5. Preserve established conversation disclosure behavior. A separate outdated filter or code-pane
   control for expanding historical threads is outside this change.

### Stored data and contracts

Keep these concepts separate in the GitHub thread contract:

| Field | Meaning | Permitted use |
| --- | --- | --- |
| `line` | Nullable provider current line, without fallback. | Eligible current inline location. |
| `originalLine` | Nullable provider historical line. | Historical metadata only. |
| `outdated` | Provider `isOutdated`; unknown for unverified legacy data. | True or unknown excludes inline placement. |
| `resolved` | Provider `isResolved`. | Independent resolution state. |

Use the plugin migration system. Legacy `line` values cannot establish whether the value came from
`line` or `originalLine`. Mark legacy location status unknown and refresh affected detail mirrors
before allowing inline placement. Keep comments and IDs intact, including while offline. Do not
label unknown status **Outdated**; use **Location unavailable** if an explanation is needed.

Carry the fields through every pagination path, mirror write and read, detail response, batch
prefetch response, and cache consumer. Treat older responses without outdated metadata as
unverified for inline placement. A successful refresh restores eligible current threads without
clearing user data or device state.

`plugins/github/src/server/mirrorQueries.ts` separately projects threads for the
`pr_review_comments` agent tool. Return outdated status and historical location there too, so agents
can distinguish historical feedback. Keep its resolution filtering. Outdated unresolved threads
remain available; their current line must not be replaced by their original line.

## Refresh consistency

[GitHub integration](../github-integration.md#diff-documents) records that detail and file mirrors
refresh separately. A thread can describe a different head from the displayed code during refresh.
Removing the fallback fixes the demonstrated defect after provider status is read, but does not
prove compatibility between independently cached detail and patches.

Before implementation, inspect revision identity across both reads. Withhold inline placement when
detail and displayed diff are known to describe different revisions. If the contracts lack the
identity needed to detect this mismatch, add the smallest plugin-owned revision metadata or
coordinated refresh mechanism that establishes compatibility. Retain unverified threads in the
conversation while refreshing. Fetch timestamps and line-range membership are not revision proof.

Preserve complete, atomic mirror replacement and segmented diff loading. Do not fetch every file
body, parse every patch, or add a client poller to determine outdated status. Historical snippet
reconstruction and remapping comments onto changed code are outside scope.

## Implementation outline

1. Extend the GraphQL thread selection and provider fixtures with outdated status. Preserve both
   line fields through all pages without substitution.
2. Add the migration, update contracts and mirror projections, and implement legacy handling and
   affected freshness gates. Establish detail and file revision compatibility.
3. Add a small, testable GitHub-owned eligibility function. Apply it before supplying inline
   threads and before requesting snippets or offering diff navigation.
4. Render conversation status through the shared UI kit and update agent feedback metadata.
5. Complete acceptance checks, then update [GitHub integration](../github-integration.md) as the
   owning reference. Update [diff rendering](../diff-rendering.md) if its generic contract changes.
   Retire this proposal after implementation and acceptance according to repository practice.

## Acceptance criteria

| Scenario | Required result |
| --- | --- |
| Outdated thread has null current line and original line 275; unrelated code occupies 275. | No inline block or current snippet. Full conversation remains with **Outdated**. |
| Outdated thread has a non-null current line. | Excluded from inline code and current snippets. |
| Current thread has a moved line. | Appears at the provider's current line on the correct side. |
| Current line is null but original line is present. | No inline placement or current snippet. |
| Current line has no matching rendered row, or the file is missing, binary, or lacks a patch. | No substitute anchor; conversation remains. |
| A visible current thread becomes outdated after refresh. | Block and layout reservation disappear; conversation updates without reopening. |
| Outdated unresolved thread becomes resolved. | Remains outside the code pane and carries independent statuses in history. |
| Outdated thread or its replies occur beyond the first provider page. | Status, line distinctions, and all replies survive pagination and mirror round trips. |
| Populated legacy database or older response lacks verified status, including while offline. | History survives; no historical line is treated as current. Refresh restores eligible threads. |
| Detail and diff describe different revisions during a push or force-push. | Unverified inline placement is withheld until compatibility is established. |
| Agent reads outdated unresolved feedback. | Feedback remains available and distinguishes current and historical locations. |

## Validation and delivery

Cover provider pagination, mirror round trips, migration of populated data, older response handling,
eligibility, conversation snippets, and refresh transitions with focused tests. Relevant starting
points include `plugins/github/src/server/routes/mirror/prFetch.test.ts`,
`plugins/github/src/server/routes/mirror/prMirror.test.ts`, and
`plugins/github/src/client/pullDetail/Conversation.test.tsx`. Test the GitHub adapter so it cannot
accidentally pass outdated threads to generic placement.

Run `pnpm lint` and relevant GitHub and architecture tests before handing back implementation.
Use `pnpm test` for the whole suite. Verify the real Tauri window through the isolated driver in
[local development](../local-development.md), inspecting unified and split views, a visible-thread
refresh, and the retained conversation. Verify the terminal projection through the isolated PTY
driver if shared kit changes affect its output.

Delivery is complete when the supplied reproduction no longer displays historical feedback beneath
unrelated code, full conversation history remains, and automated and real-window checks pass.

## Verify before building

- Re-read [architecture](../architecture-overview.md), [conventions](../conventions.md),
  [GitHub integration](../github-integration.md), and [diff rendering](../diff-rendering.md).
- Verify the cited paths and behavior against the implementation checkout.
- Confirm provider schema fields and nullability against the supported GitHub API.
- Locate the migration chain, freshness gates, batch prefetch, and agent feedback contracts.
- Trace revision identity across provider reads, Node mirrors, broker responses, caches, and consumers.
- Inspect thread layout reservation and removal before changing the adapter.
- Confirm fixtures cover both diff sides, paginated replies, populated legacy data, and mismatched
  refresh revisions.
