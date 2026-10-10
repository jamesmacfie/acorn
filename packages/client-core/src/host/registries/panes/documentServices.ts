// Who answers hover and diagnostics for a document, and the checks on what they answer
// (docs/editor/document-surface.md § Language smarts). JSX-free and editor-free, so both hosts and
// every owner share it: the desktop's CodeMirror extension, the terminal's explicit commands, a
// plugin document region, and Editor's files.
//
// A document region names its own routes and never asks this registry. Editor's files have no plugin
// of their own, so they ask by language: `contributions.documentServices`, registered by
// host/chrome/chromeRegister.ts.
import {
  DIAGNOSTIC_SEVERITIES, MAX_DIAGNOSTICS, MAX_HOVER_BYTES, MAX_LANGUAGE_REQUEST_BYTES,
  type PluginDiagnosticSeverity, type PluginPosition, type PluginRange,
} from '@acorn/protocol/documentSurface.ts'
import { utf8Exceeds } from '@acorn/protocol/extensionPoints.ts'
import type { LanguageId } from '@acorn/protocol/languageIds.ts'
import { writeJson } from '../../../infra/node/apiClient'
import { PrefKeys } from '../../../infra/persistence/prefKeys'
import { Registry } from '../../../kit/lib/state/registry'
import { slotChoices } from '../../tree/arbitration'

export type DocumentServiceKind = 'hover' | 'diagnostics'

export type DocumentServiceContribution = {
  // `<pluginId>:<id>`.
  id: string
  pluginId: string
  label: string
  languageId: LanguageId
  hover?: string
  diagnostics?: string
  // Bound by the registering pass: whether the plugin runs on that Node, so a provider is chosen on
  // the Node being viewed.
  available: (nodeId: string) => boolean
}

export const documentServiceRegistry = new Registry<DocumentServiceContribution>('document service')

/** One provider's route for one service, with who to credit beside what it draws. */
export type DocumentServiceRoute = { pluginId: string; label: string; route: string }
export type DocumentServiceRoutes = { hover?: DocumentServiceRoute; diagnostics?: DocumentServiceRoute }

export const documentServiceChoiceKey = (languageId: string, service: DocumentServiceKind): string => `${languageId}|${service}`

/** Every provider of one service for one language on this Node, for the settings picker. */
export const documentServiceCandidates = (nodeId: string, languageId: string, service: DocumentServiceKind): DocumentServiceContribution[] =>
  documentServiceRegistry.entries().filter((entry) => entry.languageId === languageId && entry[service] && entry.available(nodeId))

/**
 * Which providers serve a file in this language on this Node. The arbitration rule a `replace` slot
 * follows: one candidate serves on its own, and a tie needs the person's pick from the Node's
 * preferences. With no pick, or a pick that no longer offers the service, nobody serves, which is
 * Editor's own behaviour. Never the first to register.
 */
export function resolveDocumentServices(nodeId: string, languageId: string, prefs: Record<string, string> | undefined): DocumentServiceRoutes {
  const choices = slotChoices(prefs?.[PrefKeys.documentServices])
  const pick = (service: DocumentServiceKind): DocumentServiceRoute | undefined => {
    const candidates = documentServiceCandidates(nodeId, languageId, service)
    const chosen = candidates.length === 1
      ? candidates[0]
      : candidates.find((entry) => entry.pluginId === choices[documentServiceChoiceKey(languageId, service)])
    return chosen && { pluginId: chosen.pluginId, label: chosen.label, route: chosen[service]! }
  }
  const hover = pick('hover')
  const diagnostics = pick('diagnostics')
  return { ...(hover ? { hover } : {}), ...(diagnostics ? { diagnostics } : {}) }
}

/** Why a request wasn't sent. Shown in place of hover or diagnostics, never as an error. */
export const LANGUAGE_REQUEST_TOO_LARGE = 'Hover and diagnostics are off for this document: it is larger than 1 MiB.'

/** Is this buffer over the 1 MiB of UTF-8 a hover or diagnostics request may carry? */
export const languageRequestTooLarge = (text: string): boolean => utf8Exceeds(text, MAX_LANGUAGE_REQUEST_BYTES)

// POST a request to a provider's route on the bound Node. The answer is unchecked bytes.
const postDocumentService = (route: string, nodeId: string, body: object, signal?: AbortSignal): Promise<unknown> =>
  writeJson<unknown>(route, {
    method: 'POST', nodeId, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}),
  })

// Where each line starts, as UTF-16 offsets. Lines split on `\n`, the separator an editor's text uses.
const lineStarts = (text: string): number[] => {
  const starts = [0]
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1)
  return starts
}

const offsetIn = (text: string, starts: readonly number[], position: unknown): number | undefined => {
  if (!position || typeof position !== 'object') return undefined
  const { line, column } = position as Partial<PluginPosition>
  if (!Number.isInteger(line) || !Number.isInteger(column) || line! < 1 || column! < 1 || line! > starts.length) return undefined
  const start = starts[line! - 1]!
  const end = line! < starts.length ? starts[line!]! - 1 : text.length
  // Column `length + 1` is the end of the line, which an exclusive end needs.
  return column! - 1 <= end - start ? start + column! - 1 : undefined
}

/** A one-based position for a UTF-16 offset, the coordinates every document route uses. */
export function positionAt(text: string, offset: number): PluginPosition {
  const lines = text.slice(0, offset).split('\n')
  return { line: lines.length, column: lines[lines.length - 1]!.length + 1 }
}

/** A range as offsets into the text that was sent, or undefined when it is malformed or out of bounds. */
const rangeIn = (text: string, starts: readonly number[], range: unknown): { from: number; to: number } | undefined => {
  if (!range || typeof range !== 'object') return undefined
  const from = offsetIn(text, starts, (range as Partial<PluginRange>).start)
  const to = offsetIn(text, starts, (range as Partial<PluginRange>).end)
  return from !== undefined && to !== undefined && from <= to ? { from, to } : undefined
}

export type CheckedHover = { kind: 'plaintext' | 'markdown'; value: string; from?: number; to?: number }

/**
 * A hover answer, checked against the request it answers. Undefined for anything that should draw
 * nothing: another revision, contents of the wrong shape, empty, or over 64 KiB, or a range outside
 * the text that was sent.
 */
export function checkHover(body: unknown, sent: { text: string; revision: number }): CheckedHover | undefined {
  if (!body || typeof body !== 'object') return undefined
  const { revision, contents, range } = body as Record<string, unknown>
  if (revision !== sent.revision || !contents || typeof contents !== 'object') return undefined
  const { kind, value } = contents as Record<string, unknown>
  if ((kind !== 'plaintext' && kind !== 'markdown') || typeof value !== 'string' || !value.trim()) return undefined
  if (utf8Exceeds(value, MAX_HOVER_BYTES)) return undefined
  if (range === undefined) return { kind, value }
  const span = rangeIn(sent.text, lineStarts(sent.text), range)
  return span && { kind, value, ...span }
}

export type CheckedDiagnostic = {
  from: number
  to: number
  severity: PluginDiagnosticSeverity
  message: string
  code?: string
  source?: string
}

const SEVERITIES: ReadonlySet<unknown> = new Set(DIAGNOSTIC_SEVERITIES)
const bounded = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value ? value.slice(0, max) : undefined

/**
 * A diagnostics answer, checked against the request it answers. Undefined when the answer is for
 * another revision or isn't a list, which the owner treats as a failure and clears. Items past 200, and
 * items with a bad range, severity, or message, are dropped one by one.
 */
export function checkDiagnostics(body: unknown, sent: { text: string; revision: number }): CheckedDiagnostic[] | undefined {
  if (!body || typeof body !== 'object') return undefined
  const { revision, items } = body as Record<string, unknown>
  if (revision !== sent.revision || !Array.isArray(items)) return undefined
  const starts = lineStarts(sent.text)
  return items.slice(0, MAX_DIAGNOSTICS).flatMap((item: unknown): CheckedDiagnostic[] => {
    if (!item || typeof item !== 'object') return []
    const { range, severity, message, code, source } = item as Record<string, unknown>
    const span = rangeIn(sent.text, starts, range)
    const text = bounded(message, 2_000)
    if (!span || !SEVERITIES.has(severity) || !text) return []
    const codeText = bounded(code, 100)
    const sourceText = bounded(source, 100)
    return [{ ...span, severity: severity as PluginDiagnosticSeverity, message: text,
      ...(codeText ? { code: codeText } : {}), ...(sourceText ? { source: sourceText } : {}) }]
  })
}

/** Ask a provider about the position at `offset`, and check its answer. Undefined for a failure, an
 *  abort, or anything `checkHover` refuses. The caller checks the buffer hasn't moved on since. */
export async function requestHover(route: string, nodeId: string, sent: { text: string; revision: number; offset: number }, signal?: AbortSignal): Promise<CheckedHover | undefined> {
  const { text, revision, offset } = sent
  try {
    return checkHover(await postDocumentService(route, nodeId, { text, position: positionAt(text, offset), revision }, signal), sent)
  } catch {
    return undefined
  }
}

/** Ask a provider for diagnostics on `text`, and check its answer. Undefined for a failure, an abort, or
 *  a refused answer, all of which the owner clears its marks for. */
export async function requestDiagnostics(route: string, nodeId: string, sent: { text: string; revision: number }, signal?: AbortSignal): Promise<CheckedDiagnostic[] | undefined> {
  try {
    return checkDiagnostics(await postDocumentService(route, nodeId, { text: sent.text, revision: sent.revision }, signal), sent)
  } catch {
    return undefined
  }
}
