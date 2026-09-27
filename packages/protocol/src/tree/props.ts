// What a node's props may be, and what the host does with the rest.
//
// The security question this file answers is narrow: a stranger's code is producing an object that
// will be spread onto one of the shell's own components. The kit components enumerate the props they
// read and never spread the leftovers onto an element, so an unknown key is inert; what is not inert
// is a function, a `class`, a `style`, or a role prop carrying a raw colour. Those are what this
// refuses.
//
// ponytail: one shared schema for every node rather than one hand-written per node. The per-node
// allowlist would be defence in depth, not the load-bearing check, and it rots on every kit change.
// Upgrade path if a node ever does spread its leftovers: give `KIT_NODE_SCHEMAS` real per-node
// entries — every caller already goes through it.
import { z } from 'zod'
import { FORBIDDEN_PROPS, isKitEvent, KIT_NODES, ROLE_PROPS, ROLE_VALUES, TEXT_NODE, type KitNodeName } from './nodes.ts'
import { safeContentHref } from '../externalUrl.ts'

/** A handler on the wire. Never a function: the sandbox mints an id, the host maps it back to a
 *  closure that posts the event. */
export const handlerRef = z.object({ $handler: z.number().int().positive() }).strict()
export type HandlerRef = z.infer<typeof handlerRef>

export const isHandlerRef = (value: unknown): value is HandlerRef =>
  typeof value === 'object' && value !== null && typeof (value as HandlerRef).$handler === 'number'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

// A prop is untrusted structured-clone data. Validate it iteratively so even a very deep value
// cannot overflow Zod's parser stack before the host decides to drop that prop.
const MAX_JSON_DEPTH = 16
const MAX_JSON_VALUES = 10_000
const MAX_JSON_CHARS = 1_048_576

function boundedJson(value: unknown): value is Json {
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }]
  const seen = new WeakSet<object>()
  let values = 0
  let chars = 0
  while (pending.length) {
    const item = pending.pop()!
    if (++values > MAX_JSON_VALUES || item.depth > MAX_JSON_DEPTH) return false
    const current = item.value
    if (typeof current === 'string') {
      chars += current.length
      if (chars > MAX_JSON_CHARS) return false
      continue
    }
    if (current === null || typeof current === 'boolean') continue
    if (typeof current === 'number' && Number.isFinite(current)) continue
    if (typeof current !== 'object' || seen.has(current)) return false
    seen.add(current)
    if (Array.isArray(current)) {
      if (current.length > 1_000 || values + pending.length + current.length > MAX_JSON_VALUES) return false
      for (const child of current) pending.push({ value: child, depth: item.depth + 1 })
      continue
    }
    if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false
    let keys = 0
    for (const key in current) {
      if (!Object.hasOwn(current, key)) continue
      if (++keys > 1_000 || key.length > 64) return false
      chars += key.length
      if (chars > MAX_JSON_CHARS || values + pending.length + keys > MAX_JSON_VALUES) return false
      pending.push({ value: (current as Record<string, unknown>)[key], depth: item.depth + 1 })
    }
  }
  return true
}

const json: z.ZodType<Json> = z.custom<Json>(boundedJson)

/** One prop's value: a handler id, or plain JSON. */
export const propValue = z.union([handlerRef, json])

const nodeProps = z.record(z.string().min(1).max(64), propValue)
const textProps = z.object({ value: z.string() }).strict()

/**
 * A schema per node name, so every node in the kit has one and a future per-node tightening has a
 * place to land. `#text` is the only entry that differs today.
 */
export const KIT_NODE_SCHEMAS: Record<KitNodeName | typeof TEXT_NODE, z.ZodType> = {
  ...(Object.fromEntries(KIT_NODES.map((name) => [name, nodeProps])) as unknown as Record<KitNodeName, z.ZodType>),
  [TEXT_NODE]: textProps,
}

const forbidden: ReadonlySet<string> = new Set<string>(FORBIDDEN_PROPS)

/** How many props one node may carry. A node with more than this is not a node, it is a payload. */
export const MAX_PROP_KEYS = 64

export type SanitizedProps = { props: Record<string, unknown>; dropped: string[] }

/**
 * Keep the props that are allowed, drop the rest, and say which were dropped.
 *
 * Per prop rather than per object on purpose: a node with one bad prop still renders, which is the
 * forward-compatibility rule docs/plugins.md already has, applied to props. The caller records the
 * dropped names as a roster row.
 */
export function sanitizeProps(type: string, raw: unknown): SanitizedProps {
  const dropped: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { props: type === TEXT_NODE ? { value: '' } : {}, dropped }
  // A text run is a string and nothing else. Handled first because everything below is about props a
  // component reads, and a text run has no component.
  if (type === TEXT_NODE) {
    const entries = Object.entries(raw as Record<string, unknown>)
    const value = entries.find(([key]) => key === 'value')?.[1]
    for (const [key] of entries) if (key !== 'value') dropped.push(key)
    if (typeof value === 'string') return { props: { value }, dropped }
    return { props: { value: '' }, dropped: [...dropped, 'value'] }
  }
  const props: Record<string, unknown> = {}
  let seen = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (++seen > MAX_PROP_KEYS) {
      dropped.push(key)
      continue
    }
    if (forbidden.has(key)) {
      dropped.push(key)
      continue
    }
    // A remote tree has no authority to navigate the privileged renderer. It may offer an HTTPS
    // destination for an owner click; local routes use host actions, not an arbitrary href.
    if (key === 'href' && (typeof value !== 'string' || !safeContentHref(value)?.startsWith('https://'))) {
      dropped.push(key)
      continue
    }
    // Every `on*` is either one of the kit's twelve events carrying a handler id, or it is nothing.
    // This is what stops a raw key or pointer handler from ever existing in a remote tree.
    if (key.startsWith('on')) {
      if (isKitEvent(key) && isHandlerRef(value) && handlerRef.safeParse(value).success) props[key] = value
      else dropped.push(key)
      continue
    }
    if (isHandlerRef(value)) {
      dropped.push(key)
      continue
    }
    const role = (ROLE_PROPS as Record<string, keyof typeof ROLE_VALUES>)[key]
    if (role) {
      if (typeof value === 'string' && (ROLE_VALUES[role] as readonly string[]).includes(value)) props[key] = value
      else dropped.push(key)
      continue
    }
    if (!json.safeParse(value).success) {
      dropped.push(key)
      continue
    }
    props[key] = value
  }
  return { props, dropped }
}
