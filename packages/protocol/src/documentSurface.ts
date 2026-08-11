// The wire between a host-owned document surface and the plugin routes behind it
// (docs/future/monaco.md).
//
// Here rather than beside the editor, and that placement is the contract in miniature: these are the
// only shapes a plugin author has to know to declare a document surface, and BOTH ends read them —
// the host renders them, and the plugin's node half serves them. A shape defined on the host side and
// re-typed by every plugin is a shape that drifts.
//
// Nothing here names an editor, a vendor or a rendering engine, for the reason § Naming states at
// length: a vendor name in a manifest vocabulary is a vendor name in the wire format, permanently. The
// spellings are LSP's, which is the established vendor-neutral vocabulary for exactly this and gives a
// future terminal or mobile implementation a map to follow rather than a guess.

/** What a document `read` route answers, and what its `write` route is sent. The HOST defines this
 * shape, unlike everything else a plugin route serves, because the host is the one rendering it. */
export type PluginDocumentBody = { text: string }

// ── The completions capability (§ Language smarts) ─────────────────────────────────────────────────
//
// The host is a dumb proxy: it forwards "a completion was requested at this position" and renders
// whatever items come back. Context detection is the plugin's, on its node half, where the schema
// knowledge already lives — which is what lets a SQL console, a GraphQL console and a YAML config
// plugin share one host provider.
//
// The growth rule this sets as precedent: capabilities grow as LSP-SHAPED REQUEST/RESPONSE ROUTES —
// position and text in, standard items out — never as "run my code inside the editor". Hover and
// diagnostics can follow the same shape when a real consumer needs them; custom widgets, decorations
// and inline UI cannot, and the test for any proposed addition is "is this an LSP method".

/** POSTed to the declared completions route. Line and column are 1-based — spelled out because a
 * plugin author reading this body has no editor to ask. */
export type PluginCompletionRequest = { text: string; position: { line: number; column: number } }

/** LSP's `CompletionItemKind`, narrowed to the handful a host can render meaningfully and spelled as
 * names rather than LSP's magic numbers: this wire is read by plugin authors, not by an LSP client. An
 * unknown kind renders as `text` rather than failing the whole popup. */
export const COMPLETION_KINDS = ['text', 'keyword', 'field', 'class', 'function', 'value'] as const
export type PluginCompletionKind = (typeof COMPLETION_KINDS)[number]

/** One suggestion. `insertText` defaults to `label`, which is the common case. */
export type PluginCompletionItem = {
  label: string
  kind?: PluginCompletionKind
  insertText?: string
  detail?: string
}

/** What a completions route answers. */
export type PluginCompletionResponse = { items: PluginCompletionItem[] }

/** Bounded, because a popup is a popup: a route answering with ten thousand rows is a stall, and a
 * truncated list is a normal thing for a completion provider to return. */
export const MAX_COMPLETION_ITEMS = 200
