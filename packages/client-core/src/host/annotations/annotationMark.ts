import {
  isAnnotationSeverity,
  MAX_ANNOTATION_DETAIL_BYTES,
  utf8Exceeds,
  type AnnotationDetail,
  type PluginAnnotationKey,
  type PluginAnnotationMark,
} from '@acorn/protocol/extensionPoints.ts'

const str = (value: unknown): value is string => typeof value === 'string' && value.length > 0

function sanitizeDetail(value: unknown, nodeId: string): AnnotationDetail | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { kind, value: text } = value as Record<string, unknown>
  if (kind !== 'markdown' && kind !== 'plaintext') return undefined
  if (!str(text) || utf8Exceeds(text, MAX_ANNOTATION_DETAIL_BYTES)) return undefined
  // A plugin can't name its own Node, so `acorn://this/` in its detail means the Node that answered
  // (docs/frontend/acorn-links.md § Links in mark detail). Nowhere else is `this` a Node ID.
  return { kind, value: text.replaceAll('acorn://this/', `acorn://${nodeId}/`) }
}

/**
 * One mark, reduced to what the host is willing to draw: a key of scalars, one of three severities, a
 * line of text, an optional icon name, and optional detail. No colour, no verb, and markup only inside
 * `detail`, which the host sanitizes when it draws it. `nodeId` is the Node that answered.
 *
 * Every contributor's answer comes through here, loaded or compiled. A bad `detail` costs the mark its
 * detail, not the mark.
 */
export function sanitizeAnnotationMark(row: unknown, nodeId: string): PluginAnnotationMark | null {
  if (!row || typeof row !== 'object') return null
  const mark = row as Record<string, unknown>
  if (!str(mark.text) || !isAnnotationSeverity(mark.severity)) return null
  if (!mark.key || typeof mark.key !== 'object' || Array.isArray(mark.key)) return null
  const key: PluginAnnotationKey = {}
  for (const [field, value] of Object.entries(mark.key as Record<string, unknown>)) {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    key[field] = value
  }
  const detail = sanitizeDetail(mark.detail, nodeId)
  return {
    key,
    severity: mark.severity,
    // Capped like every other display string a plugin sends: this lands under a diff row, not in a
    // pane of its own.
    text: mark.text.slice(0, 200),
    ...(str(mark.icon) ? { icon: mark.icon } : {}),
    ...(detail ? { detail } : {}),
  }
}
