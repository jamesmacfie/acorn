import { describe, expect, it } from 'vitest'
import { DATA_LIMITS, MISSING, canonicalDataEncoding, canonicalDataProjection, parseDataPointer, parseDataValue, parseVersionedDataValue, readDataPointer, type DataValue } from './dataValues'

describe('typed JSON values', () => {
  it('preserves typed nested values and enforces the envelope version', () => {
    const value = { title: 'record', count: 1, done: false, owner: null, items: [{ id: 'a' }] }
    expect(parseVersionedDataValue({ version: 1, value })).toEqual({ version: 1, value })
    expect(() => parseVersionedDataValue({ version: 2, value })).toThrow()
    expect(() => parseVersionedDataValue({ version: 1 })).toThrow()
  })
  it('rejects values JSON would silently change and never invokes accessors', () => {
    for (const value of [NaN, Infinity, undefined, new Date(), [undefined], Array(2), { x: undefined }]) expect(() => parseDataValue(value)).toThrow()
    let reads = 0
    const getter = { get x() { reads++; return 'bad' } }
    expect(() => parseDataValue(getter)).toThrow()
    expect(() => readDataPointer(getter, '/x')).toThrow()
    expect(reads).toBe(0)
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    expect(() => parseDataValue(cyclic)).toThrow()
  })
  it('accepts exact byte and depth limits, rejects the next unit', () => {
    expect(parseDataValue('é', 4)).toBe('é')
    expect(() => parseDataValue('é', 3)).toThrow()
    let value: DataValue = 0
    for (let depth = 0; depth < DATA_LIMITS.depth; depth++) value = [value]
    expect(parseDataValue(value)).toEqual(value)
    expect(() => parseDataValue([value])).toThrow()
  })
  it('reads escaped own properties and distinguishes absent from null', () => {
    expect(readDataPointer({ 'a/b': { '~': null } }, '/a~1b/~0')).toBeNull()
    expect(readDataPointer({}, '/missing')).toBe(MISSING)
    expect(readDataPointer([], '/length')).toBe(MISSING)
    expect(readDataPointer(['a'], '/00')).toBe(MISSING)
    expect(readDataPointer(Object.create({ x: 1 }) as DataValue, '/x')).toBe(MISSING)
    for (const path of ['/__proto__', '/constructor/x', '/prototype', '/bad~2', 'x']) expect(parseDataPointer(path)).toBeNull()
    expect(parseDataPointer('/a'.repeat(DATA_LIMITS.depth))).not.toBeNull()
    expect(parseDataPointer('/a'.repeat(DATA_LIMITS.depth + 1))).toBeNull()
    expect(parseDataPointer('/' + 'a'.repeat(DATA_LIMITS.pointerChars - 1))).not.toBeNull()
    expect(parseDataPointer('/' + 'a'.repeat(DATA_LIMITS.pointerChars))).toBeNull()
  })
  it('canonicalizes object order but preserves array order and primitive types', () => {
    expect(canonicalDataEncoding({ b: 2, a: 1 })).toBe(canonicalDataEncoding({ a: 1, b: 2 }))
    expect(canonicalDataEncoding([1, 2])).not.toBe(canonicalDataEncoding([2, 1]))
    expect(canonicalDataEncoding(1)).not.toBe(canonicalDataEncoding('1'))
    expect(canonicalDataProjection({}, ['/x'])).not.toBe(canonicalDataProjection({ x: null }, ['/x']))
    expect(canonicalDataProjection({ a: 1, b: 2 }, ['/a', '/b'])).toBe(canonicalDataProjection({ b: 2, a: 1 }, ['/b', '/a']))
  })
})
