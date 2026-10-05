# Phase 10: add Markdown fence viewers

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 09. Editor file viewers remain a separate prerequisite and owner.

Let plugins render completed Markdown code fences by language while the owner preserves source,
copy, streaming selection, and block lifetime. Start with kit UI and explicit overlay expansion.

## Starting point and owners

`packages/client-core/src/kit/lib/rendering/markdown.ts` parses and sanitizes rendered blocks.
`packages/client-core/src/kit/components/content/Markdown.tsx` reconciles block elements, highlights
raw fence HTML, and mounts copy controls. Fences are not `CodeBlock` component instances.
`packages/client-core/src/host/components/ProviderHtml.tsx` is a different provider-HTML path.
`plugins/agents/src/client/sessions/ManagedAgentMarkdown.tsx` is a host-owned transcript adapter.
`packages/client-core/src/host/tree/TreeHost.tsx` draws remote nodes with host-only mounting context.

Read [remote points](../../plugins/remote-points.md), [UI tiers](../../plugins/ui-tiers.md),
and [client lifetime](../../managed-agents/client-surfaces.md).

## Contract

Core owns `core:markdown-fence`, `remote`, `replace`, keyed by the lowercased language hint. Preserve
the original hint in props. Normalize published language aliases only when their equivalence is defined.
Pass `{ blockId, language, text, revision, taskId?, projectId? }`, capped at 256 KiB of fence text.
Incomplete streaming fences and oversize fences draw source only and start no contributor.

The owner draws Source/Preview and Copy outside replacement UI. A changed fence becomes source until
its replacement has the matching revision. Keep at most four visible/expanded fence contributors per
content owner; further fences remain source with an explicit Preview action to replace an earlier mount.
No per-fence persistent preference is required; use owner-local state until unmount.

Only host-owned Markdown content and top-level loaded owner surfaces with bound content scope opt in.
A Markdown node emitted inside a cooperative contributor does not open another cooperative point.
In particular, a remote Markdown Editor viewer keeps ordinary fences until nested composition has a
separate approved design. This phase does not weaken the one-level slot restriction.

Pixel renderers use a remote summary plus a declared companion overlay. Inline iframe fence replacement
is deferred. Provider HTML is excluded until it has reliable source-fence metadata.

## Steps

1. Add the typed core point and discovery. Extend the parser's private block metadata to identify
   completed fenced blocks and source text without parsing rendered HTML back into source.
2. Add a presentation-only fence mount adapter to Markdown internals. A host wrapper supplies
   contributor mounting, identity, and scope; the kit imports no registry and workers supply no callbacks.
   Keep the ordinary Markdown node behavior when that host adapter is absent or nesting is disallowed.
3. Reconcile by owner/block identity, preserving prior unchanged nodes and selection. Dispose the
   old contributor before reusing a replaced block and keep highlights/copy independent of preview UI.
4. Add a loaded JSON/table fence viewer fixture. Add a declared overlay fixture for pixel expansion
   only if needed to prove that carrier path; no arbitrary HTML, external page, or inline iframe is required.
5. Add terminal Source/Preview controls and bounded remote views. Companion overlay refusal leaves
   the source or summary usable and visible. Enforce the same mount cap in both hosts.

## Tests and acceptance

Extend `markdown.test.ts`, `Markdown.test.tsx`, `MarkdownLifetime.test.tsx`, TreeHost tests, and
terminal document tests. Cover incomplete streaming fences, repeated equal fences, insertion/removal,
changed language/text, selection in preceding blocks, stale render reads, cap enforcement, contributor
disable, source copy, and a Markdown node inside a contributed tree attempting to nest.

Run `pnpm lint`, full suites for `@acorn/client-core`, `@acorn/plugin-agents`, `@acorn/tui`, affected
protocol/SDK packages, and architecture. Expect exit zero. Stream Markdown in both real hosts and
toggle a completed fence. Record that unchanged blocks retain selection and hidden fences start no worker.

Complete when source/copy remain owned, completed fences mount bounded contributors, and no renderer
is incorrectly assumed to cover raw Markdown fences just because it covers `CodeBlock`.

## Verify before building

- Recheck parser block keys, completion metadata, sanitization, and disposal paths.
- Recheck whether an opt-in host mount is a top-level owner or a cooperative contributor.
- Stop if this requires generic nested remote slots or reconstructing source from untrusted rendered HTML.
