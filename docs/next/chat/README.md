# Workspace chat plugin

**Status:** implementation design · **Written against:** `98d6110` · **Date:** 2026-07-11

This folder specifies a first-party Acorn plugin for ordinary model chat. The first release connects
directly to OpenAI and Anthropic, streams responses, accepts explicit attachments, keeps all thread
history and local attachment data scoped to the selected Acorn workspace, and appears as a source in
the left rail.

This is an implementation handoff, not documentation for a shipped feature. It is intentionally
compatible with later providers and later workspace-context contributions without building retrieval,
tools, agents, memory injection, or implicit repository context in the first release.

## Product boundary

The first release includes:

- a persistent chat source in `rail.sources`, visible in every workspace even before a provider is
  configured;
- app-wide shared provider credentials plus workspace-scoped model selection, threads, messages,
  drafts, and attachments;
- OpenAI Responses API and Anthropic Messages API adapters behind an Acorn-owned provider contract;
- text, image, PDF, and UTF-8 text/code attachments that the selected model actually receives;
- background streaming over Acorn's authenticated WebSocket, cancellation, retry of failed/cancelled
  turns, reconnect recovery from SQLite, and completion notifications;
- safe Markdown, inline code, fenced code with Shiki highlighting, local image previews, file cards,
  per-code-block copy, and whole-response copy;
- thread create, rename, archive, delete, and workspace-local history navigation.

The first release does **not** include:

- automatic repository, task, note, memory, PR, terminal, or integration context;
- RAG, embeddings, vector stores, web search, tools, function calls, MCP, or agent behavior;
- provider-hosted thread state as the source of truth;
- remote file persistence through OpenAI/Anthropic Files APIs;
- generated images, audio, voice, artifacts, message branching, sharing, sync, or cross-workspace search.

Prior messages in the current thread are still normal conversational history. “No context” means no
implicit Acorn/workspace material is added beyond that history and attachments the user explicitly
chooses.

## Documents

| Document | Purpose |
| --- | --- |
| [architecture.md](./architecture.md) | Current Acorn seams, target topology, ownership, end-to-end data flow, and key decisions |
| [domain-model.md](./domain-model.md) | Canonical TypeScript contracts, SQLite tables, invariants, state machines, retention, and migration behavior |
| [provider-and-context.md](./provider-and-context.md) | Provider adapter contract, OpenAI/Anthropic mapping, model catalog, prompt assembly, budgeting, and the empty future-context seam |
| [api-and-streaming.md](./api-and-streaming.md) | Internal HTTP resources, idempotent turn creation, WebSocket frames, cancellation, reconnect, and error vocabulary |
| [ui-and-interactions.md](./ui-and-interactions.md) | Complete component inventory, layout, bubbles, composer, model picker, scrolling, actions, notifications, keyboard, and accessibility |
| [attachments-and-rendering.md](./attachments-and-rendering.md) | Upload lifecycle, object store, supported formats, provider delivery, image/file UI, safe Markdown, code rendering, and copy behavior |
| [security-and-operations.md](./security-and-operations.md) | Secrets, data privacy, untrusted content, limits, concurrency, logging, cleanup, failure recovery, and observability |
| [implementation-plan.md](./implementation-plan.md) | Ordered implementation phases, exact target files, test gates, stop conditions, rollout, and definition of done |
| [references.md](./references.md) | Primary-source GitHub and provider-doc research, takeaways adopted, and patterns deliberately rejected |

## Architectural decisions

1. **Chat is a source plugin, not a task pane.** It is workspace-level history and does not require a
   task, repo, branch, or worktree. The source contribution renders a full chat browse view.
2. **Acorn owns the canonical conversation.** SQLite rows and local objects are authoritative. Never
   depend on `previous_response_id`, a provider thread id, or a provider file id to reconstruct a
   conversation. That keeps provider switching and offline history possible.
3. **Provider formats stop at adapters.** Stored messages use Acorn content parts. OpenAI/Anthropic
   request, response, stream-event, error, and usage shapes never cross into renderer or database
   contracts.
4. **Use official provider SDKs behind a narrow registry.** This keeps provider-specific capabilities
   available and works with Acorn's current Node baseline. Do not expose either SDK to UI code. Revisit
   a third-party unified SDK only when adding several more providers makes the adapter cost material.
5. **Start turns with HTTP; stream with the shared WebSocket.** `POST` atomically creates the user
   message, assistant placeholder, and run, then returns `202`. The run continues if the user changes
   source/thread. Deltas and terminal events share one authenticated, typed socket.
6. **SQLite is the recovery stream.** WebSocket frames are low-latency hints, not durable event log.
   Aggregated assistant text checkpoints to SQLite; reconnect invalidates/refetches the thread and then
   continues with later frames.
7. **Attachments are local owned data, not cache blobs.** Metadata is workspace-scoped T2 data and
   bytes live in a bounded content-addressed chat object store. The existing GitHub `BLOBS` cache has
   different retention and access semantics and must not be reused.
8. **Inline attachments in provider requests for v1.** Images/PDFs use provider-supported base64 input;
   text/code is decoded and sent as text. This avoids remote file lifecycle/retention. Provider file
   uploads remain an optional adapter optimization later.
9. **Credentials reuse the shipped app-wide model-provider foundation.** OpenAI and Anthropic keys
   live in core `integrations` rows and remain write-only to the renderer. Chat stores only a selected
   connection/model preference per workspace or thread. Model providers remain outside the
   external-item integration registry, whose source/link/cache semantics do not fit generation.
10. **Future context enters through one empty assembler stage.** The v1 prompt manifest always records
    `contextItems: []`. Later notes/files/memory contributions populate typed snapshots there; they do
    not mutate stored chat messages or provider adapters.
11. **Rendered model content is untrusted.** Parse Markdown to a controlled component tree, disable raw
    HTML, reject unsafe URLs, do not auto-load remote images, and render Shiki tokens rather than
    injecting provider HTML.
12. **Notify on missing attention, not merely window blur.** A completion is acknowledged only when the
    exact workspace/thread chat surface is visible and the document is focused. Being elsewhere in a
    focused Acorn window still qualifies for a completion notification.

## Dependency order

```text
schema + repositories
        |
        +--> provider registry/adapters --> run service --> HTTP + WebSocket
        |                                      |
        +--> attachment object store ----------+
                                               |
source/settings contributions --> chat client state --> UI/rendering/notifications
```

The durable model, provider contract, and fake-provider conformance harness land before real provider
SDKs or UI. The UI must be able to run end-to-end against the fake provider before OpenAI/Anthropic
credentials are required.

## Repository drift note

The worktree already contained unrelated, uncommitted public-API changes while this design was written,
including an untracked `0023` migration and edits to `schema.ts`, `bindings.ts`, and server composition.
An implementer must inspect the live diff, use the next available migration identifier, and merge
composition changes rather than overwriting them. The implementation plan has explicit drift and stop
conditions for this.
