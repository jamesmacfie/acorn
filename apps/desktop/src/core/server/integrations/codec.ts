import type { ExternalRef } from '../../shared/integrations'
import type { CachedExternalItem, CachedItemCodec, CodecResult } from './types'

export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function parseCached<TSummary, TDetail, TPublic>(
  codec: CachedItemCodec<TSummary, TDetail, TPublic>,
  raw: string,
  ref: ExternalRef,
): CodecResult<CachedExternalItem<TSummary, TDetail>> {
  return codec.parse(parseJson(raw), ref)
}

export function encodeCached(item: CachedExternalItem, maxBytes: number): string {
  const encoded = JSON.stringify(item)
  if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) return encoded
  const withoutDetail = JSON.stringify({ ...item, detail: undefined, truncated: true })
  if (Buffer.byteLength(withoutDetail, 'utf8') <= maxBytes) return withoutDetail
  return JSON.stringify({ ref: item.ref, summary: item.summary, schemaVersion: item.schemaVersion, truncated: true })
}
