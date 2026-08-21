// The wire between a host-owned document surface and the plugin routes behind it. See
// docs/third-party/monaco.md § Naming for why nothing here names an editor, a vendor, or a rendering
// engine, and why the spellings are LSP's.

/** What a document `read` route answers, and what its `write` route is sent. The host defines this
 * shape, unlike everything else a plugin route serves, because the host is the one rendering it. */
export type PluginDocumentBody = { text: string }

// The completions capability (§ Language smarts). See docs/third-party/monaco.md § Language smarts:
// completions, and the growth rule for why the host is a dumb proxy, and why capabilities grow only
// as LSP-shaped request/response routes.

/** POSTed to the declared completions route. Line and column are 1-based, spelled out because a
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
