import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { markReactive } from '@openuidev/lang-core'
import { z } from 'zod'

// What both conformance runners share: the case folders, the test library's spec, and comparison.
// The cases and their rules are in conformance/README.md.

type Dict = Record<string, unknown>
type Params = { properties?: Dict }

const FIXTURES = join(import.meta.dirname, '../conformance/1.0')

export const readCase = (...path: string[]) => readFileSync(join(FIXTURES, ...path), 'utf8')

/** Every case as `area/name`, sorted. */
export const caseIds = (): string[] =>
  readdirSync(FIXTURES, { withFileTypes: true })
    .filter((area) => area.isDirectory())
    .flatMap((area) =>
      readdirSync(join(FIXTURES, area.name), { withFileTypes: true })
        .filter((c) => c.isDirectory())
        .map((c) => `${area.name}/${c.name}`),
    )
    .sort()

export const caseFiles = (id: string): Record<string, string> =>
  Object.fromEntries(readdirSync(join(FIXTURES, id)).map((file) => [file, readCase(id, file)]))

export const spec = JSON.parse(readCase('library.json')) as {
  root: string
  schema: {
    $defs: Record<string, Params>
    functions?: Record<string, { description?: string; params: Params }>
    actions?: Record<string, { params: Params }>
  }
  components: Record<string, { signature: string; description: string }>
}

/**
 * A component's props as Zod, in the schema's key order, with the reactive mark on the props whose
 * signature prints `$binding<`. Evaluation needs nothing else; parsing uses library.json's schema as is.
 */
export function propsOf(component: string): z.ZodObject {
  const bindable = new Set([...spec.components[component].signature.matchAll(/(\w+)\??: \$binding</g)].map((m) => m[1]))
  return paramsOf(spec.schema.$defs[component], bindable)
}

export function paramsOf({ properties = {} }: Params, bindable = new Set<string>()): z.ZodObject {
  const shape = Object.keys(properties).map((key) => {
    const schema = z.any()
    if (bindable.has(key)) markReactive(schema)
    return [key, schema]
  })
  return z.object(Object.fromEntries(shape))
}

export const json = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))
export const same = (a: unknown, b: unknown) => isDeepStrictEqual(json(a) ?? null, json(b) ?? null)
