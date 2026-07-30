# Agents Client and UI

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-AGENT`

Electron owns all renderer implementation, layout, focus, keyboard dispatch, host approvals,
notifications, and fleet aggregation. The Agents Node supplies authorized semantic documents,
resource snapshots, patches, events, and streams.

## Contributions

| Contribution | Host surface | Renderer/fallback |
| --- | --- | --- |
| `agents.center` | Fleet source | `acorn.collection/2`, `acorn.content/2`, `acorn.agent-timeline/2`; bounded list/status fallback |
| `agents.task` | Task pane, order 15, default chord `meta+shift+a` | `acorn.agent-timeline/2`; read-only transcript fallback |
| `agents.task-sidebar` | Agent pane side slot | list/attention renderer |
| `agents.attention` | Fleet attention provider | generic attention list |
| `agents.notifications` | notification kinds | generic host notice |
| `agents.context-picker` | host modal within composer | forms/tree/list renderers |
| `agents.usage` | Agent pane header and settings | status/detail renderer |
| `agents.pricing` | Settings page | standard forms |
| `agents.tool-fallback` | agent-tool renderer | safe generic structured card |

`CUR-AGENT-050` Agent Center MUST aggregate sessions from every connected Node while retaining the
Node badge and node-qualified session URI. Search is federated as bounded per-Node queries; partial
failure returns merged results plus per-Node stale/offline/error state.

`CUR-AGENT-051` Agent Center preserves workspace/provider/status filters, history, unread/attention
ordering, provider health, transcript import, and task-scoped launch. Opening an item navigates to
its owning Node, workspace, task, session, and optional request/event.

`CUR-AGENT-052` The task Agent pane MUST retain session tabs, normalized transcript, composer,
queued turns, requests, artifacts, lifecycle actions, configuration options, context preview, and a
same-task sidebar. It MUST NOT show a session owned by another task merely because the route or
provider matches.

## Transcript and request rendering

`CUR-AGENT-053` Transcript items use `acorn.agent-timeline/2` and cover owner message, assistant
text, provider-marked displayable reasoning, plans, tools, file changes, terminals, attachments,
artifacts, usage, diagnostics, errors, provider requests, compaction, and completion.

`CUR-AGENT-054` Streaming updates patch one stable item ID in sequence. Duplicates are ignored;
gaps display a discontinuity and trigger authorized snapshot recovery. Partial text MUST be visibly
unfinished until finalization.

`CUR-AGENT-055` Markdown uses the host sanitized renderer: raw HTML, unsafe schemes, automatic
remote images, data URLs, executable markup, and plugin CSS are rejected. Paths and resources become
typed intents only after validation.

`CUR-AGENT-056` Tool cards match by declared tool schema coordinate. Missing, incompatible, failed,
or quarantined specialist renderers fall back to tool title, status, redacted structured fields,
and safe resource links.

`CUR-AGENT-057` Permission, question, elicitation, and workflow-gate controls are host-owned. A card
shows provider, session, requesting tool/operation, exact bounded effect, task/resource, risk,
expiry, and valid choices. Transcript content cannot create, cover, or preselect an approval.

`CUR-AGENT-058` Resolving a request requires current revision and an idempotent Node command.
Pending, resolving, resolved, expired, version-conflict, disconnected, and ambiguous-outcome states
are visually distinct; the Client never retries an approval automatically.

## Composer, context, queue, and controller

`CUR-AGENT-059` The composer supports text, task-rooted file mentions, validated attachments,
images, immutable context snapshots, provider commands, configuration, send, and cancellation. It
shows the 512 KiB Acorn context budget and any smaller provider limit before dispatch.

`CUR-AGENT-060` Context selection is a host modal over declared `context-section` capabilities.
Every selection shows source, option, captured time, freshness, sensitivity, byte/token estimate,
and owning-pane intent before capture.

`CUR-AGENT-061` File mention autocomplete queries only the task root and sends canonical file
resources plus optional 1-based line range. Absolute host paths and another task's files never
appear.

`CUR-AGENT-062` Attachments show validation progress, media type, size, retry/removal, and
post-upload reference state. The Client MUST NOT cache attachment bodies by default or render
untrusted media outside the bounded host viewer.

`CUR-AGENT-063` Queued turns display stable order, source, edit/reorder/cancel availability, dispatch
state, and failure. Editing or reordering issues a revision-checked command and rolls back
optimistic UI on rejection.

`CUR-AGENT-064` Managed, Terminal, and external controller states are explicit. “Continue in
terminal” explains that managed input will lock, completes/cancels active work, and navigates to the
created Terminal session. “Return to managed” is enabled only after clean Terminal exit and provider
resume verification.

`CUR-AGENT-065` An imported session is labeled read-only. Verification failure leaves its history
readable and offers a context-copy fork; it does not enable the composer.

## Sidebar, attention, and notifications

`CUR-AGENT-066` The same-task sidebar merges managed sessions, raw Terminal agent sessions, and
Workflow attention through public snapshots/events. Ordering is needs-you, active, then remaining
newest-first. It never imports Terminal or Workflow implementation state.

`CUR-AGENT-067` Selecting a managed row changes the current transcript; selecting a request scrolls
and focuses its exact host-owned card; selecting a raw session invokes the Terminal focus intent;
selecting workflow attention invokes its owning navigation intent.

`CUR-AGENT-068` Agent attention events feed the Fleet inbox and notification center. Toasts are
edge-triggered and deduplicated by node/session/request/event; sensitive prompt, filename,
repository path, response, and tool arguments are excluded from OS notifications.

`CUR-AGENT-069` Session read state is a Node command updating `lastReadSequence`. Opening a session
does not acknowledge unseen events until its contiguous snapshot/stream has rendered.

## Usage, pricing, states, and accessibility

`CUR-AGENT-070` The Agent header shows provider utilization summary and an accessible hover/focus
detail. The usage section shows session/weekly/model windows, reset times, health, plan/account-safe
metadata, measured versus estimated cost, stale timestamp, per-provider failure, and refresh.

`CUR-AGENT-071` Health tones are semantic and accompanied by text: at least 50 percent remaining is
healthy, 20–49 is warning, 1–19 is critical, and zero/unavailable is neutral with an explanation.
An unavailable provider does not hide other providers.

`CUR-AGENT-072` Settings → Agent pricing lists built-in groups, exact overrides, recently unpriced
models, currency/rates, reset, validation errors, save status, and estimation disclosure using the
standard forms renderer.

`CUR-AGENT-073` Loading, empty, stale, offline, permission-denied, renderer-unsupported, provider
unavailable, plugin-degraded, and Node-disconnected states MUST each preserve task/session identity
and provide a valid retry, setup, permission, Terminal fallback, or diagnostic action.

`CUR-AGENT-074` Keyboard operation covers session tabs, transcript items, composer, queued turns,
request choices, context picker, artifacts, and lifecycle menus. Focus returns to the initiating
control after modal/approval completion and does not jump on incoming stream patches.

`CUR-AGENT-075` All status and attention states have text alternatives and do not rely on color,
animation, or icons. Live transcript announcements are rate-limited and never announce hidden
reasoning or secret questions.

`CUR-AGENT-076` The Agent pane minimum desktop width remains 640 px. At narrower negotiated sizes
the sidebar collapses into a roster sheet while transcript and approval remain usable.

`CUR-AGENT-077` Future mobile fallback is status, attention, approvals, bounded transcript, queue
and cancellation; it MAY omit provider configuration, large artifacts, terminal handoff, and rich
tool renderers while showing explicit unsupported actions.

`CUR-AGENT-078` Client-local draft text and selection may persist only for the current paired device
and session policy. Secret questions, provider credentials, approval choices, tool output, and
attachment bodies MUST NOT enter general Client persistence.

`CUR-AGENT-079` UI conformance MUST exercise every contribution with ready, empty, loading, stream,
high-rate, gap, offline, stale, denied, unsupported, provider-failed, plugin-failed, update,
quarantine, and accessibility states.
