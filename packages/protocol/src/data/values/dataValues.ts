/** Version 1 of the shared typed-data contract. Bounds apply before consumer effects. */
export const DATA_VERSION = 1 as const
export const DATA_LIMITS = {
  depth: 12,
  fields: 256,
  descriptionChars: 2048,
  labelChars: 80,
  pointerChars: 2048,
  predicateDepth: 4,
  comparisons: 50,
  options: 100,
  previewRecords: 25,
  selectionRecords: 5000,
  selectionBytes: 16 * 1024 * 1024,
  recordBytes: 256 * 1024,
  detailBytes: 1024 * 1024,
  queryMs: 60_000,
  queryPages: 100,
} as const
export type DataPrimitive = string | number | boolean | null
export type DataValue = DataPrimitive | DataValue[] | { [key: string]: DataValue }
export type VersionedDataValue = { version: typeof DATA_VERSION; value: DataValue }
export const MISSING = Symbol('missing data value')
export type DataRead = DataValue | typeof MISSING

export function parseVersionedDataValue(input: unknown): VersionedDataValue {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected versioned data value')
  const descriptors = Object.getOwnPropertyDescriptors(input)
  if (
    Object.keys(descriptors).length !== 2 || descriptors.version?.value !== DATA_VERSION
    || !descriptors.value || !('value' in descriptors.value)
  ) throw new Error('Unsupported data value version or envelope')
  return { version: DATA_VERSION, value: parseDataValue(descriptors.value.value) }
}

export function parseDataPointer(pointer: unknown): string[] | null {
  if (typeof pointer !== 'string' || pointer.length > DATA_LIMITS.pointerChars) return null
  if (pointer === '') return []
  if (!pointer.startsWith('/')) return null
  const parts = pointer.slice(1).split('/')
  if (parts.length > DATA_LIMITS.depth) return null
  const decoded: string[] = []
  for (const part of parts) {
    if (/~(?:[^01]|$)/.test(part)) return null
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return null
    decoded.push(key)
  }
  return decoded
}

/** Own data properties only: accessors and inherited properties are never evaluated. */
export function readDataPointer(value: DataValue, pointer: string): DataRead {
  const parts = parseDataPointer(pointer)
  if (!parts) throw new Error('Invalid data pointer')
  let current: DataValue = value
  for (const key of parts) {
    if (current === null || typeof current !== 'object') return MISSING
    if (Array.isArray(current) && !/^(0|[1-9][0-9]*)$/.test(key)) return MISSING
    const property = Object.getOwnPropertyDescriptor(current, key)
    if (!property) return MISSING
    if (!('value' in property)) throw new Error('Data accessors are unsupported')
    current = property.value as DataValue
  }
  return current
}

/** Validate and copy JSON without invoking toJSON, getters, or prototype properties. */
export function parseDataValue(input: unknown, maxBytes: number = DATA_LIMITS.detailBytes, maxDepth: number = DATA_LIMITS.depth): DataValue {
  function visit(value: unknown, depth: number): DataValue {
    if (depth > maxDepth) throw new Error('Data nesting exceeds limit')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value
    if (typeof value !== 'object' || !value) throw new Error('Expected a JSON value')
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new Error('Expected a plain object')
    }
    const entries = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Symbol properties are unsupported')
    const result: DataValue[] | Record<string, DataValue> = Array.isArray(value) ? [] : {}
    for (const key of Object.keys(entries)) {
      if (Array.isArray(value) && key === 'length') continue
      const property = entries[key]!
      if (!('value' in property) || !property.enumerable) throw new Error('Expected enumerable data properties')
      if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) throw new Error('Invalid array property')
      Object.defineProperty(result, key, {
        value: visit(property.value, depth + 1), enumerable: true, writable: true, configurable: true,
      })
    }
    if (Array.isArray(value) && Object.keys(entries).length !== value.length + 1) throw new Error('Sparse arrays are unsupported')
    return result
  }
  const value = visit(input, 0)
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxBytes) throw new Error('Data exceeds byte limit')
  return value
}

export function canonicalDataEncoding(value: DataValue): string {
  const parsed = parseDataValue(value, DATA_LIMITS.selectionBytes)
  function encode(item: DataValue): string {
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`
    if (item !== null && typeof item === 'object') {
      const entries = Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key]!)}`)
      return `{${entries.join(',')}}`
    }
    return JSON.stringify(item)
  }
  return encode(parsed)
}

/** Addresses are included; missing and null have distinct encodings, as do strings and numbers. */
export function canonicalDataProjection(value: DataValue, pointers: readonly string[]): string {
  return JSON.stringify([...new Set(pointers)].sort().map(pointer => {
    const selected = readDataPointer(value, pointer)
    return [pointer, selected === MISSING ? ['missing'] : ['value', canonicalDataEncoding(selected)]]
  }))
}
