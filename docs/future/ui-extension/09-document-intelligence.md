# Phase 09: add document hover and diagnostics

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 08. Follow the document contract's typed language-service growth rule.

Let plugins supply language hover and diagnostics through confined Node routes. The host draws their
results and owns editor state. Do not expose editor vendor extensions or arbitrary inline widgets.

## Starting point and owners

`packages/protocol/src/content/documentSurface.ts` defines completion requests with one-based
`{ line, column }` positions. `packages/client-core/src/features/editor/DocumentSurface.tsx` maps
declared completion routes onto the host editor. `apps/tui/src/plugins/DocumentSurface.tsx` supplies
the terminal projection. `plugins/database/src/server/completions.ts` is a real route-backed consumer.
`plugins/editor/src/client/EditorPane.tsx` owns file documents and their language identity.

Read [language smarts](../../editor/document-surface.md#language-smarts),
[document surfaces](../../plugins/document-surfaces.md), and [the manifest](../../plugin-authoring/the-manifest.md).

## Contract

Add optional `hover: { route }` and `diagnostics: { route }` to document region declarations.
Routes belong to the declaring plugin. An explicit document-region route wins over file-language
providers, so a database scratch document never receives another plugin's SQL results accidentally.

For file Editor consumers, add `contributions.documentServices` descriptors with
`{ id, label, languageId, hover?, diagnostics? }`. Each optional service names an own-plugin route;
at least one is required. Validate language IDs and ownership at Node parse and client arrival.
Select one provider per language and service on the viewed Node, with a settings choice and owner
fallback on ties or unavailable choices. Reuse arbitration semantics, not a registration-order winner.

Hover receives `{ text, position, revision }` and returns `{ revision, contents, range? }`.
Contents are bounded `{ kind: 'plaintext' | 'markdown', value }`, at most 64 KiB, rendered sanitized.
Diagnostics receives `{ text, revision }` and returns `{ revision, items }`, at most 200 items.
Each item has a one-based range with exclusive end, severity, message, and optional string code/source.
These are a documented subset of language-server vocabulary with Acorn's completion coordinate convention.
Do not claim byte-for-byte LSP compatibility or change completion coordinates in this phase.

Use the live buffer. Cap requests at 1 MiB UTF-8 and show an unavailable reason for larger documents.
No absolute path or file grant is implicit. Provider data may use its own declared Node capabilities.
Reject stale revisions and invalid/out-of-bounds ranges before drawing.

## Steps

1. Add protocol types, optional descriptor fields, file-service declarations, route confinement,
   schemas, discovery, and per-Node provider settings. Preserve completion declarations unchanged.
2. Add document-owner adapters for hover requests and a 500 ms diagnostics debounce after changes.
   Abort prior reads on buffer, scope, provider, or registration changes. Empty/failing results clear
   that provider's UI, without disturbing completion, saving, selection, or other owner marks.
3. Draw bounded host tooltips and diagnostic markers/list entries. Terminal offers explicit Inspect
   position and Diagnostics commands, using the same routes and coordinates; no hover pointer is assumed.
4. Add database schema hover through its document declaration, reusing its schema readers. Add a
   loaded JSON syntax diagnostic provider fixture for file Editor, demonstrating the language registry.
5. Keep diagnostics read-only. Do not add fixes, commands embedded in Markdown, CodeMirror imports
   into providers, a language-server process manager, or network access to the client worker.

## Tests and acceptance

Extend DocumentSurface tests, Editor tests, protocol/manifest route tests, database route tests, and
terminal document tests. Cover provider ties, explicit owner precedence, one-based positions, Unicode,
unsaved text, oversized requests, invalid ranges, malicious Markdown, errors, and stale revisions.
Prove two SQL document owners do not share provider state and completion/saving remain unchanged.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/node-core`, `@acorn/client-core`,
`@acorn/plugin-editor`, `@acorn/plugin-database`, `@acorn/tui`, declaration packages, and architecture.
Expect exit zero. Check SQL hover and a live JSON error in both hosts; fix the JSON and confirm clearing.

Complete when both owned-region and file-language routes work with bounded, revision-safe results,
and no provider code runs inside the editor.

## Verify before building

- Recheck the shipped document capability schema and completion coordinate conventions.
- Recheck file language identity after Editor viewer work and the provider-choice settings precedent.
- Stop if the solution needs an editor-specific API or an undeclared universal language-server runtime.
