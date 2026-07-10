# Chat UI and interaction specification

## Product shape

Chat is a workspace-level source in the left rail. It is not attached to a task, terminal, or GitHub integration. Selecting it opens a full-height chat surface for the currently selected workspace.

The source remains visible when no model provider is configured. In that state, the surface explains what is required and offers connection setup. Hiding the source would make discovery and recovery unnecessarily difficult.

## Surface hierarchy

```text
ChatSourceView
├── ChatSidebar
│   ├── NewChatButton
│   ├── ThreadSearchInput
│   ├── ThreadList
│   │   └── ThreadListItem
│   └── ProviderSettingsButton
└── ChatThreadView
    ├── ChatHeader
    │   ├── ThreadTitle
    │   ├── ModelSelector
    │   └── ThreadActionsMenu
    ├── MessageTimeline
    │   ├── TimelineStatusRow
    │   └── ChatMessage
    │       ├── MessageAuthor
    │       ├── MessageParts
    │       ├── MessageAttachments
    │       └── MessageActions
    ├── JumpToLatestButton
    └── MessageComposer
        ├── PendingAttachmentList
        ├── ComposerTextarea
        ├── AttachButton
        ├── SendOrStopButton
        └── ComposerStatus
```

On narrow layouts, `ChatSidebar` becomes a thread drawer. The thread remains the primary surface; the composer must never be squeezed below its usable minimum width.

## Source integration

The source contribution should use an explicit availability predicate rather than a connected-integration capability:

```ts
type SourceViewContext = {
  workspaceId: string;
  workspacePath: string;
};

type SourceContribution = {
  id: string;
  label: string;
  icon: Component;
  order?: number;
  when?: (context: SourceViewContext) => boolean;
  component: Component<SourceViewContext>;
};
```

The chat source registers with `when: ({ workspaceId }) => Boolean(workspaceId)`. This is a core extensibility improvement: workspace-native sources should not have to impersonate external integrations.

The source icon should show only lightweight state:

- a dot when a run completes while its chat surface lacks attention;
- an activity indicator while the selected workspace has an active run;
- no message preview, model output, or attachment name in the rail.

## Chat sidebar

### New chat

`NewChatButton` creates a local thread immediately with the currently selected default model. It should focus the composer. An empty thread is deleted automatically if the user leaves without sending anything.

### Thread list

Threads are grouped by recency: Today, Previous 7 days, Previous 30 days, and Older. Each item shows:

- title;
- relative last activity time;
- active streaming indicator, if applicable;
- unread completion dot;
- archived threads only when the archive filter is active.

The row menu supports rename, archive/unarchive, and delete. Delete requires confirmation and explains that local messages and unreferenced attachment files will be removed. Actions must be keyboard reachable without first selecting the thread.

Initial thread titles are deterministic: the first non-empty user text, truncated on a grapheme boundary, or the first attachment filename. Do not make a second model request solely to generate a title in the first release.

Thread search is local and initially matches title plus textual message content. Debounce input and query the server; do not load the entire history into the renderer.

### Empty and setup states

The sidebar remains usable while provider setup is incomplete. The main pane displays one of these explicit states:

1. no provider connection: explain local storage and link to provider setup;
2. provider connected, no models available: show the provider error and retry;
3. no threads: show the new-chat introduction;
4. thread load failure: preserve navigation and offer retry.

## Header and model selection

`ModelSelector` is searchable and groups models by provider. Each model row shows its display name and capability badges for image, document, and streaming support. Disabled rows explain why they cannot accept the composer’s current attachments.

Selection rules:

- a model is selected per thread and persisted;
- changing it affects future turns only;
- the existing model remains recorded on every run and assistant message;
- if the selected model disappears, retain the historical identifier, show it as unavailable, and require a valid model before the next send;
- provider defaults seed new threads but never rewrite old threads;
- connection removal does not delete history.

The header menu contains rename, archive, delete, and provider settings. It should also expose the thread’s provider/model provenance without crowding each message bubble.

## Message timeline

### Message grouping

User and assistant messages use distinct alignment and surface treatment, but must retain accessible author labels. Consecutive messages are not merged in the data model; visual grouping is permitted.

Every assistant turn has a stable placeholder before the upstream request starts. This prevents layout replacement when streaming begins and gives errors or cancellation a durable home.

Message order is by the server-assigned monotonic position, not client time. A reconnect may deliver deltas after a checkpoint query; the client merges by run sequence and ignores duplicates.

### Streaming presentation

Render incoming text at most once per animation frame. Keep mutable stream buffers outside fine-grained rendered nodes, then commit coalesced text. This avoids reparsing Markdown for every token.

During streaming:

- show an unobtrusive activity state on the assistant message;
- render the largest safely parseable Markdown prefix and the incomplete suffix as plain text;
- expose Stop in the composer and on the active message;
- keep copying disabled until there is content, but it may copy the stable current snapshot;
- never show provider event names or raw wire errors to users.

On terminal state, replace the activity state with completion, cancellation, or an actionable error. Partial content remains visible after cancellation or a mid-stream error and is labeled as partial.

### Scroll anchoring

The timeline follows output only while the user is already near the bottom. Once the user scrolls up, preserve their position and show `JumpToLatestButton` with an activity badge. Returning to the bottom restores follow mode.

Prepending older messages must preserve the first visible message and pixel offset. Use a sentinel/intersection observer for pagination and measure before and after insertion.

### Message actions

`MessageActions` appears on hover and focus, and is always reachable on touch. Initial actions:

- Copy: copy concatenated textual/code content in display order, excluding hidden metadata;
- Retry: create a new run from the same user turn when the assistant run failed or was cancelled;
- Stop: active run only;
- view error details: user-safe message plus correlation ID;
- attachment open/save actions on attachment parts.

Do not implement in-place regeneration that overwrites an assistant message. A retry creates a distinct assistant message/run so provenance and recovery remain unambiguous. Branching alternatives can be introduced later without migrating overwritten data.

## Message composer

### Text input

The textarea grows to a capped height and then scrolls internally. Keyboard behavior:

- Enter sends when the configured preference is “Enter to send”;
- Shift+Enter inserts a newline;
- when “Enter inserts newline” is selected, Cmd/Ctrl+Enter sends;
- Escape closes menus, but never silently clears a draft;
- IME composition must complete before Enter can send.

The unsent draft and pending attachment references are persisted as T3 view state per workspace and thread. Uploaded-but-unsent attachments remain reclaimable by cleanup policy.

Send is enabled only when there is text or at least one ready attachment, a valid model is selected, no upload is pending, and the thread has no active run. Validation is displayed next to the blocked control, not only in a tooltip.

### Attachment selection

Users can add attachments through:

- the native file picker;
- drag and drop onto the composer;
- pasting supported images/files from the clipboard.

The pending list shows upload progress, type, filename, size, removal, retry, and validation errors. A message cannot reference an attachment until upload finalization succeeds. Removing an attachment from the draft removes the reference, not necessarily the underlying object immediately; garbage collection handles unreferenced objects.

### Send and stop

Sending snapshots the text, ordered attachment IDs, thread model selection, and future context selection into a canonical input manifest. The composer clears only after the server accepts the turn. A rejected request keeps the draft intact.

While the run is active, the primary action becomes Stop. Stop is idempotent and should acknowledge promptly even if the provider transport takes time to close.

## Rendering message parts

The renderer is driven by ordered typed parts rather than one HTML string:

```ts
type MessagePartView =
  | { type: "text"; markdown: string }
  | { type: "code"; language?: string; code: string }
  | { type: "attachment"; attachmentId: string }
  | { type: "image"; attachmentId: string; alt?: string }
  | { type: "context-citation"; contextItemId: string }
  | { type: "status"; label: string };
```

The first release writes text and attachment parts. Reserving the other variants prevents provider-specific JSON or future context citations from leaking into the UI contract.

Detailed parsing and file behavior are specified in [attachments-and-rendering.md](attachments-and-rendering.md).

## Focus, attention, and notifications

`document.hasFocus()` is insufficient because the app can be focused on another workspace, source, or thread. A chat surface has attention only when all are true:

```ts
type ChatAttention = {
  documentFocused: boolean;
  selectedWorkspaceId: string | null;
  selectedSourceId: string | null;
  selectedThreadId: string | null;
};

function isRunAttended(run: ChatRun, attention: ChatAttention): boolean {
  return attention.documentFocused
    && attention.selectedWorkspaceId === run.workspaceId
    && attention.selectedSourceId === "chat"
    && attention.selectedThreadId === run.threadId;
}
```

When a run reaches `completed` and is not attended:

1. persist a notification targeted at `{ type: "chat-thread", workspaceId, threadId }`;
2. show an in-app toast under the existing notification preference policy;
3. set the thread and Chat rail unread indicators;
4. optionally issue an OS notification only if the existing product preference and platform permission permit it.

Clicking the notice selects the workspace, Chat source, and thread. Opening that exact surface marks completion notices for the thread read. Failed runs may use the same route with error severity; cancelled runs do not notify by default.

The notification schema must generalize its current task-only target instead of inventing a parallel chat notification store.

## Accessibility

- The message list uses semantic articles with author and timestamp labels; it is not a constantly announcing live region.
- A small polite live region announces “Response started,” “Response completed,” or “Response failed,” never each token.
- Streaming status includes text and does not rely on animation or color.
- All controls have accessible names and visible focus treatment.
- Code blocks expose language, copy, and horizontal scrolling without trapping keyboard focus.
- Attachment thumbnails have useful alt text based on filename unless the user supplies better text later.
- Menus, selectors, and the thread drawer restore focus to their invoking control.
- Respect reduced-motion preferences for streaming cursor, rail activity, and scrolling.

## Responsive behavior

Recommended breakpoints are behavioral, not tied to a particular device:

- wide: persistent thread sidebar and thread view;
- constrained: collapsible sidebar retaining a visible thread switcher;
- very narrow: full-screen thread drawer, compact header, model selector in a sheet.

The composer and message measure should remain readable. Do not stretch prose across the full window; code and tables may overflow within their own containers.

## UI state ownership

| State | Owner | Persistence |
| --- | --- | --- |
| Threads, messages, runs, attachment metadata | Server repository | SQLite, T2 |
| Attachment bytes | Server object store | Workspace-owned files, T2 |
| Selected thread and source | Existing app navigation | T3/T4 according to current navigation policy |
| Composer draft and pending references | Chat UI state slice | T3, per workspace/thread |
| Open menu, hover, active drop target | Component | T4 |
| Stream assembly and sequence cursor | Chat query/stream client | T4, recovered from server |
| Provider keys | Server credential service | Encrypted durable secret, never renderer state |

## Visual and interaction acceptance criteria

- Chat is discoverable in every real workspace without a configured provider.
- A response continues when the user changes source, thread, or workspace.
- Returning mid-stream reconstructs the durable prefix and resumes live deltas without duplication.
- Scrolling up never snaps the user to the bottom as new text arrives.
- A rejected send preserves text and attachment selections.
- Every mouse-only action has a keyboard and touch path.
- Provider and model history remains understandable after configuration changes.
- Completion notification occurs when the exact chat is unattended, including when the app is focused elsewhere.
