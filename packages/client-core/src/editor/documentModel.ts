// The parts of a host-owned document surface that are not a component (docs/future/monaco.md).
//
// Everything here is deliberately pure or a plain module-level map, because the surface itself is a
// .tsx and this repo's vitest runs in node with no Solid plugin — a green suite proves nothing about
// a component, so the logic worth pinning lives on this side of the file boundary.
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/pluginBridge.ts'
import { onScopeEvicted } from '../registries/scopeEviction'

// The shapes both ends read — the body a document route serves, and the completion request/response
// pair — live on the wire (`@acorn/protocol/documentSurface.ts`), not here. A plugin's NODE half serves
// them, and it cannot import client-core. Re-exported so the editor half still has one place to read
// them from.
export type {
  PluginCompletionItem,
  PluginCompletionKind,
  PluginCompletionRequest,
  PluginCompletionResponse,
  PluginDocumentBody,
} from '@acorn/protocol/documentSurface.ts'
export { COMPLETION_KINDS, MAX_COMPLETION_ITEMS } from '@acorn/protocol/documentSurface.ts'

/** Read bodies are bytes from a node. A document big enough to wedge the renderer is refused rather
 * than truncated — half a file in an editor that will happily save it back is data loss. Declared on the
 * wire (`@acorn/protocol/pluginBridge.ts`) because the frame's `document.write` is held to the same
 * ceiling; re-exported here so this module stays the one place the editor half reads it from. */
export { MAX_DOCUMENT_BYTES }

/** The scope a pane was mounted in. Both are optional because a project-scoped pane has no task and a
 * task-scoped one has both. */
export type DocumentScope = { taskId?: string; projectId?: string }

/** What a composed pane's FRAME may do to the document it shares the rectangle with
 * (docs/future/monaco.md § Communication between regions). Three methods, each with a proven consumer,
 * and deliberately nothing about the editor — no cursor, no selection, no decorations. */
export type DocumentHandle = {
  read(): string
  write(text: string): void
  flush(): Promise<void>
}


// The only two parameters the host substitutes, and the reason the list is closed: these are the two
// values the HOST holds about the pane it is drawing. Anything else in a path is the plugin naming
// something the host has no business inventing, so it is left alone and the route 404s honestly.
const SUBSTITUTIONS = ['taskId', 'projectId'] as const

/**
 * Fill `:taskId` / `:projectId` in a declared route from the pane's scope. `null` when the path needs
 * a value this scope does not have — a task-scoped route on a project pane — so the surface can say
 * so instead of fetching a URL with a literal `:taskId` in it.
 *
 * Values are percent-encoded, which is what keeps the parse-time confinement check honest at runtime:
 * a substituted value cannot introduce a `/` and walk out of the plugin's own namespace.
 */
export function resolveDocumentRoute(path: string, scope: DocumentScope): string | null {
  let resolved = path
  for (const name of SUBSTITUTIONS) {
    // The negative lookahead is what stops `:taskId` matching inside a plugin's own `:taskIdentifier`.
    const token = new RegExp(`:${name}(?![A-Za-z0-9_])`, 'g')
    if (!resolved.match(token)) continue
    const value = scope[name]
    if (!value) return null
    // A function replacement, so a `$&` in an id cannot be read as a replacement pattern.
    resolved = resolved.replace(token, () => encodeURIComponent(value))
  }
  return resolved
}

/** The document's identity, minted by the host from the surface it belongs to. The degenerate
 * `document` template serves exactly one document per scope, so there is nothing for the plugin to
 * name; a multi-document template gets a real uri from its document-list route when it lands. */
export const documentUri = (pluginId: string, surfaceId: string): string => `plugin:${pluginId}/${surfaceId}`

// ── View state ────────────────────────────────────────────────────────────────────────────────────
//
// Scroll and cursor, which under the old arrangement were the plugin's: plugins/editor stores a
// Monaco `ICodeEditorViewState` in its own module map. That blob cannot cross a contract that does not
// name Monaco, and the answer is not to serialise it — it stops being the plugin's at all. It is host
// state keyed by (node, scope, uri), evicted by the host's own eviction signals, and the plugin never
// sees it.
//
// `unknown` rather than the Monaco type on purpose: this module is the storage, not the editor, and
// the one caller that knows what the blob is casts at the boundary.
const viewStates = new Map<string, unknown>()

const viewKey = (nodeId: string, scopeId: string, uri: string): string => `${nodeId}/${scopeId}:${uri}`

export const rememberDocumentViewState = (nodeId: string, scopeId: string, uri: string, state: unknown): void => {
  viewStates.set(viewKey(nodeId, scopeId, uri), state)
}

export const documentViewState = (nodeId: string, scopeId: string, uri: string): unknown =>
  viewStates.get(viewKey(nodeId, scopeId, uri))

/** Every node's entries for this scope, not just the active node's: archival is final, and a key left
 * behind under another node's prefix would never be reached again. */
export function evictDocumentViewStates(scopeId: string): void {
  const suffix = `/${scopeId}:`
  for (const key of viewStates.keys()) if (key.includes(suffix)) viewStates.delete(key)
}

export function clearDocumentViewStates(): void {
  viewStates.clear()
}

// Registered beside the signal it clears, which is the rule scopeEviction.ts states at length. Note
// what does NOT clear on a node switch: view state is keyed BY node, so switching back restores where
// the reader was — the same treatment editor scroll already gets.
onScopeEvicted((eviction) => {
  if (eviction.scope === 'task') evictDocumentViewStates(eviction.taskId)
  else if (eviction.scope === 'workspace') evictDocumentViewStates(eviction.workspaceId)
})
