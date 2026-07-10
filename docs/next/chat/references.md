# Research references and adopted lessons

Research was performed on 2026-07-11. Links point to upstream projects or primary provider documentation. Implementation must recheck current SDK/runtime compatibility and API behavior because these projects and APIs evolve.

## Open-source chat applications and libraries

### Vercel Chatbot

- Repository: <https://github.com/vercel/chatbot>
- Relevant areas: `components/chat`, `components/message`, `components/multimodal-input`, attachment previews/actions, model selection, database schema, and resumable stream records.
- Adopted: split thread/messages/composer/actions into focused components; create a durable assistant placeholder; typed message parts; upload queue before send; explicit stop action; model capability gating; copy textual parts rather than copying rendered HTML.
- Deliberately different: Acorn uses SQLite and its existing authenticated WebSocket, owns provider adapters, and persists workspace-scoped data rather than adopting the application’s Next.js/Postgres deployment model.

### assistant-ui

- Repository: <https://github.com/assistant-ui/assistant-ui>
- Relevant concepts: Thread, Message, Composer, ThreadList, ActionBar primitives; runtime adapters; streaming, retry, attachment, auto-scroll, Markdown/code, and accessibility concerns.
- Adopted: separate reusable view primitives from runtime state; precise scroll-follow behavior; actions must be focus/touch accessible; adapters normalize streaming into a stable UI contract.
- Deliberately different: do not introduce a second chat runtime/store abstraction on top of Acorn’s services and query/state systems. The project is a design reference, not a framework dependency.

### LibreChat

- Repository: <https://github.com/danny-avila/LibreChat>
- Relevant concepts: multiple model providers, attachment handling, resumable streaming, conversation history, and separation of attachment persistence from preview rendering.
- Adopted: provider diversity belongs behind adapters; persisted file identity and UI previews are separate concerns; interrupted streams need durable partial state and recovery.
- Deliberately different: version one has no tools, agents, search, remote file authority, or broad endpoint compatibility layer.

### Open WebUI

- Repository: <https://github.com/open-webui/open-webui>
- Relevant concepts: backend-owned model dispatch, WebSocket activity, file lifecycle, provider breadth, and batching streaming updates for renderer performance.
- Adopted: provider calls outlive individual views; coalesce token updates before rendering; treat file storage as a lifecycle rather than a message JSON field.
- Deliberately different: use Acorn’s in-process server/core contracts and keep first-release provider configuration intentionally small.

### LobeHub / LobeChat

- Repository: <https://github.com/lobehub/lobe-chat>
- Relevant concepts: large provider/model ecosystem, model metadata, provider-specific capabilities, and provider settings UX.
- Adopted: model identity is provider-qualified and capability-bearing; unavailable historical models remain understandable; the model catalog is data rather than a switch statement spread through UI code.
- Deliberately different: no attempt to ship the ecosystem’s full provider catalog in version one.

### Vercel AI SDK

- Repository: <https://github.com/vercel/ai>
- Relevant concepts: a normalized provider interface, streaming events, message parts, and provider package separation.
- Adopted: an Acorn-owned canonical provider contract and event normalization are essential.
- Deliberately different: do not make the AI SDK the domain boundary in version one. Its runtime/support policy can move independently of Acorn, and official provider SDKs expose provider behavior directly. Revisit once Acorn’s supported Node runtime and the SDK’s current requirements align and the dependency demonstrably reduces code without leaking its types.

### Official SDK repositories

- OpenAI Node SDK: <https://github.com/openai/openai-node>
- Anthropic TypeScript SDK: <https://github.com/anthropics/anthropic-sdk-typescript>
- Adopted: official transport, streaming, errors, cancellation, and request types at each adapter edge.
- Boundary: SDK objects and errors are normalized immediately and do not enter persisted records, shared UI contracts, or provider-neutral services.

## Primary provider documentation

### OpenAI

- Streaming Responses: <https://developers.openai.com/api/docs/guides/streaming-responses>
- Images and vision inputs: <https://developers.openai.com/api/docs/guides/images-vision>
- File inputs: <https://developers.openai.com/api/docs/guides/file-inputs>
- Responses API reference: <https://platform.openai.com/docs/api-reference/responses/create>

Architectural consequences:

- normalize lifecycle and text delta events rather than exposing OpenAI event names to clients;
- use the Responses API for the initial adapter;
- keep local canonical conversation state instead of requiring provider response chaining;
- support request-local image/file input but avoid provider-persistent file identity in version one;
- tolerate additive unknown stream events while preserving ordering and terminal/error handling.

### Anthropic

- Streaming Messages: <https://platform.claude.com/docs/en/build-with-claude/streaming>
- Messages API create: <https://platform.claude.com/docs/en/api/messages/create>
- Files API guide: <https://platform.claude.com/docs/en/build-with-claude/files>
- TypeScript Messages reference: <https://platform.claude.com/docs/en/api/typescript/messages>

Architectural consequences:

- normalize message/content-block lifecycle into the same Acorn stream events used by OpenAI;
- treat ping, error, and additive unknown events explicitly;
- convert canonical ordered message parts at the adapter boundary;
- prefer request-local content in version one even though a Files API exists;
- model availability and attachment capability remain provider/model-specific data.

## Markdown and rendering security

- Marked security warning and documentation: <https://github.com/markedjs/marked>
- Remark ecosystem: <https://github.com/remarkjs/remark>
- Unified syntax tree ecosystem: <https://github.com/unifiedjs/unified>

Adopted lesson: parsing Markdown does not make output safe. The plan uses a syntax tree rendered through owned Solid components, disables raw HTML, validates links, blocks remote images, and never assigns provider output to `innerHTML`.

## Acorn-specific evidence

These repository documents and modules establish the local constraints used in the design:

- [Plugin architecture](../../plugins.md)
- [Extensibility roadmap](../extensibility.md)
- [Contribution model](../contribution-points.md)
- [State ownership and policies](../state-and-policies.md)
- [Security direction](../security.md)
- [UX direction](../ux.md)
- `apps/desktop/src/core/client/registries/sources.ts`
- `apps/desktop/src/core/server/routeRegistry.ts`
- `apps/desktop/src/core/shared/ws.ts`
- `apps/desktop/src/core/client/notifications/notifications.ts`
- `apps/desktop/src/core/server/db/schema.ts`
- `apps/desktop/src/core/server/blobs.ts`
- `apps/desktop/src/plugins/github/client/shiki.ts`

The principal local conclusions are:

- Chat is a workspace source, not a task pane or external-item integration;
- HTTP plus the existing authenticated WebSocket is the established transport boundary;
- SQLite is the durable app-data authority and explicit cascade behavior is required;
- the existing GitHub blob cache is not an owned attachment store;
- notifications and source contributions need small general-purpose pressure changes;
- state tiers distinguish durable chat data from drafts, view selection, and live stream buffers.

## What was not copied

No reference implementation is adopted wholesale. In particular, this plan does not copy:

- a hosted web application deployment model into Electron;
- provider SDK or third-party AI SDK types into Acorn’s domain model;
- provider-owned thread/file IDs as canonical state;
- raw HTML/Markdown renderer output;
- tools, agents, repository context, or remote retrieval hidden inside “chat”;
- token-by-token component updates;
- attachment bytes embedded in SQLite JSON or WebSocket frames.

Those exclusions are what keep the first release bounded while preserving clean future extension points.
