// The wire between a host-owned document surface and the plugin routes behind it. See
// docs/editor/document-surface.md § Naming for why nothing here names an editor, a vendor, or a rendering
// engine, and why the spellings are LSP's.

/** What a document `read` route answers, and what its `write` route is sent. The host defines this
 * shape, unlike everything else a plugin route serves, because the host is the one rendering it. */
export type PluginDocumentBody = { text: string }

// The completions capability (§ Language smarts). See docs/editor/document-surface.md § Language smarts:
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

// Hover and diagnostics (§ Language smarts). The same growth rule: a documented subset of LSP's
// `textDocument/hover` and published diagnostics, with the completion coordinates above rather than
// LSP's zero-based ones. Not byte-for-byte LSP, and not a language server.

/** One-based, like a completion position. `column` counts UTF-16 code units, which is what an editor
 *  offset counts, so a character outside the Basic Multilingual Plane is two columns. */
export type PluginPosition = { line: number; column: number }

/** A span of the document. `end` is exclusive, the convention `content.selection` ranges use. */
export type PluginRange = { start: PluginPosition; end: PluginPosition }

/** POSTed to a hover route. `revision` is the host's edit counter for this buffer; echo it back. */
export type PluginHoverRequest = { text: string; position: PluginPosition; revision: number }

/** What a hover route answers. `range` says which text the hover is about; absent means the position.
 *  Markdown is drawn sanitized: no images, no HTML, links only to http, https, and mailto. */
export type PluginHoverResponse = {
  revision: number
  contents: { kind: 'plaintext' | 'markdown'; value: string }
  range?: PluginRange
}

/** LSP's `DiagnosticSeverity`, spelled as names for the reason completion kinds are. */
export const DIAGNOSTIC_SEVERITIES = ['error', 'warning', 'information', 'hint'] as const
export type PluginDiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number]

export type PluginDiagnostic = {
  range: PluginRange
  severity: PluginDiagnosticSeverity
  message: string
  code?: string
  source?: string
}

/** POSTed to a diagnostics route: the whole live buffer, saved or not. */
export type PluginDiagnosticsRequest = { text: string; revision: number }

/** What a diagnostics route answers. An empty list clears the provider's marks. */
export type PluginDiagnosticsResponse = { revision: number; items: PluginDiagnostic[] }

/** Hover contents past this many UTF-8 bytes are refused, not cut: a cut Markdown body can change
 *  meaning. */
export const MAX_HOVER_BYTES = 64 * 1024
/** Diagnostics past this many are dropped, the way a long completion list is cut. */
export const MAX_DIAGNOSTICS = 200
/** No hover or diagnostics request carries a buffer larger than this many UTF-8 bytes. The host shows
 *  why instead of sending it. */
export const MAX_LANGUAGE_REQUEST_BYTES = 1024 * 1024
