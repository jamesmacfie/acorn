# The renderer and untrusted content

This page covers the privileged webview's content security policy, the two places the renderer
inserts text it didn't author, and how provider payloads and AI authoring input are bounded before
they reach it. Read it before you render provider data or change a sanitizer. It's part of the
[security model](../security.md).

## The renderer's policy

The privileged webview, the one that holds a capability so `invoke` works, loads from `app://acorn`
and gets its Content-Security-Policy as a response header from
`apps/desktop/src-tauri/src/app_scheme.rs`. [The shell](../shell/origins.md#renderer-origin-and-protocol-handler)
owns the directive list and the reason for each exception. A Rust test pins it, the same way
`plugin_scheme.rs` pins the frame policy.

`tauri.conf.json` sets `"csp": null`, and that isn't a gap. That value governs Tauri's built-in asset
protocol, which this app doesn't use. A security review read the config and concluded the privileged
webview had no policy. It has one, served from `app_scheme.rs`.

## The dangerous sinks

The renderer displays text this app didn't author: agent transcripts, GitHub `bodyHTML`, Linear
descriptions, Rollbar payloads, and notes an agent wrote. The CSP is a second layer behind two sinks.

**Provider HTML.** Two bindings insert provider-rendered HTML:
`packages/client-core/src/host/components/ProviderHtml.tsx`, which every provider body goes through,
and the diff's `SanitizedHtml` in `packages/client-core/src/kit/diff/DiffRows.tsx`. Both call
`packages/client-core/src/kit/lib/rendering/sanitizedHtml.ts` first. It parses the string in an inert
template, then builds fresh text and a small allowlist of formatting elements.

- The only attribute it copies is a validated absolute HTTPS `href`. Links get host-owned `target`
  and `rel` values.
- Scripts, forms, foreign namespaces, images, embeds, styles, other automatic resource loads, and
  every provider attribute are dropped.
- `class` is read only as a lookup. The GitHub class names that mark a suggested change's removed and
  added lines, and the ones that colour its code, are replaced with fixed host class names, so the
  provider's string is never written.
- Input length, node count, and depth are bounded. The host adds bare-reference links only after
  this pass.

**Markdown.** `packages/client-core/src/kit/lib/rendering/markdown.ts` is the app's own renderer. It
escapes first and builds tags afterwards. It emits images only from bounded raster data URLs. A remote
image URL in Node-provided markdown becomes alt text, so it can't trigger a request from the client's
network. The renderer reserves U+E000 as a sentinel for code spans and images, and `renderMarkdown`
strips that character on the way in. A source that spelled the sentinel could otherwise forge an index
into the token tables and crash the render.

## Untrusted provider data

Rollbar occurrences and other provider payloads are parsed into bounded, allowlisted projections
before they're stored or drawn. Raw payloads, request headers, cookies, bodies, IP addresses, and
arbitrary provider objects are dropped. A normalization failure rejects the item rather than widening
the projection. The allowlist runs even when the sender's SDK already scrubbed common secret keys,
because acorn can't rely on a filter it doesn't control.

AI authoring treats source metadata and opted-in preview records as untrusted prompt content. A model
can ask only for the closed metadata operations parsed by `@acorn/protocol/authoring.ts`. The Node
checks the selected workspace and project on each request, uses the source runtime for provider
authorization, and limits one turn to eight metadata requests and two candidate attempts. Record
samples need a device opt-in and are limited to three records and 16 KiB. The authoring routes accept
only device principals and expose no publish, run, schedule, provider-write, or credential operation.
Task agents get separate read-only metadata tools through the normal tool permissions.

Workflow schedule authoring and approval need a device principal. At approval, and before each root
task, the workflows plugin resolves the published graph and checks repository trust, source
availability, connection ownership, and destination scope again through core and source capabilities.
A client can't supply an internal principal, an intended task ID, or a frozen graph. The schedule
target holds only the workflow-owned binding ID. Loaded plugins can't register user schedule target
kinds or call the root-task creation seam.
