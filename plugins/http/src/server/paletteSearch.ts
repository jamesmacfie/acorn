import { MAX_COMMAND_SEARCH_ITEMS, type CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { httpRequests } from '../node/schema'

// Ranking the palette's saved-request rows, over the stored row rather than the opened request.
//
// The types say it: this file takes `SavedRequestRow`, which is what came out of SQLite, and every
// field it touches — the name, the folder, the method — is a plaintext column. The five encrypted
// columns are the URL, the headers, the body, the auth block and the variables, and none of them is
// read here, so no ciphertext is opened and there is nothing in a row that could be a secret
// (../server/storage.ts). Contrast ./agentContext.ts, which does open them and therefore carries a
// redaction pass and an allowlist.
//
// That is stronger than filtering a secret out afterwards, which is the property phase 5 asks for:
// "never headers, bodies, auth material, resolved variables, or secret values"
// (docs/future/command-palette/phase-5-loaded-plugin-adoption.md § HTTP). Not even the URL, which the
// rail beside this also leaves out: a saved URL is regularly `?token=…` typed literally, and there is
// no way to recognise which literal is a secret.
//
// The ranking itself runs on the node, so the shell's `fuzzyScore` is not available (that lives in
// client-core's kit); the tiers below are the same idea spelled for a short, stable list, with equal
// matches keeping the order they arrived in, which is the folder-then-name order the rail lists.

// The bound @acorn/protocol/commands.ts holds a row to.
const TITLE = 300
const SUBTITLE = 300

/** What this file is allowed to see: the row, minus every column the node encrypted. */
export type SavedRequestSummary = Pick<typeof httpRequests.$inferSelect, 'id' | 'name' | 'folder' | 'method'>

/**
 * How well one saved request answers `query`, or `null` for a row that does not answer it at all.
 *
 * Higher is better, and within a tier the incoming order decides.
 */
export function savedRequestSearchScore(row: SavedRequestSummary, text: string): number | null {
  const needle = text.trim().toLowerCase()
  if (!needle) return 0
  const name = row.name.toLowerCase()
  if (name === needle) return 4
  if (name.startsWith(needle)) return 3
  if (name.includes(needle)) return 2
  // The folder is how a person groups requests, so its words are how they look for one: typing
  // "auth" should find everything filed under `auth/`.
  if (row.folder.toLowerCase().includes(needle)) return 1
  // `POST` last, because a method matches a great many rows and is a filter rather than a name.
  if (row.method.toLowerCase() === needle) return 0
  return null
}

/** One row, as the palette draws it. The id is the request's own, which is the item the project
 *  surface's route captures (`/p/:projectId/x/http/requests/:requestId`), so picking a row addresses
 *  exactly what clicking it in the rail does. */
export const savedRequestSearchItem = (row: SavedRequestSummary): CommandSearchItem => ({
  id: row.id,
  title: row.name.slice(0, TITLE),
  ...(row.folder ? { subtitle: row.folder.slice(0, SUBTITLE) } : {}),
  badge: row.method,
  icon: 'send',
})

/** The matching rows, best first, capped at what the host will render anyway. */
export function savedRequestSearchItems(rows: readonly SavedRequestSummary[], text: string): CommandSearchItem[] {
  return rows
    .map((row, at) => ({ row, at, score: savedRequestSearchScore(row, text) }))
    .filter((entry): entry is { row: SavedRequestSummary; at: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, MAX_COMMAND_SEARCH_ITEMS)
    .map((entry) => savedRequestSearchItem(entry.row))
}

/**
 * A name for an imported cURL command, since the command line has none.
 *
 * The last meaningful path segment, which is what a person calls the endpoint, with the method in
 * front so two imports of the same path do not read identically. A template URL
 * (`{{BASE_URL}}/users`) is the common case and does not parse, so this is string surgery rather than
 * `new URL()` — the same reason ./agentContext.ts gives.
 */
export function importedRequestName(method: string, url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? ''
  const segment = withoutQuery.split('/').filter((part) => part && !part.startsWith('{{')).pop()
  return `${method} ${segment ?? url}`.slice(0, 200)
}
