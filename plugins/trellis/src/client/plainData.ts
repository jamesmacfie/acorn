/** A program's value as plain JSON data: strings, numbers, booleans, null, arrays, and plain objects,
 *  with anything else dropped. A program can read a built-in function off any value and put it on an
 *  object as `toString` or `toJSON`, which `String()` and `JSON.stringify` would then call. So the host
 *  passes every program value through this before it reads, sends, or prints it. */
export function plainData(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object' || depth > 32) return undefined
  if (Array.isArray(value)) return value.map((item) => plainData(item, depth + 1) ?? null)
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      const copy = plainData(item, depth + 1)
      return copy === undefined ? [] : [[key, copy]]
    }),
  )
}

/** A program value as text to draw: a string, number, or boolean, and nothing for anything else. */
export const plainText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
