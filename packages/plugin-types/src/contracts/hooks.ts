// ── Hooks ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A turn in one of your decisions, offered to other plugins (docs/plugins/hooks.md § Hooks).
 *
 * The difference between a hook and an event: an event has already happened and nobody can stop it; a
 * hook runs *before*, in a chain, with a return value. "Task archived" is an event. "Before I push,
 * does anyone object" is a hook.
 *
 * Two halves. `declare` plus `run` is the owner's: say what the moment is and what is allowed at it,
 * then call `run` at the moment and act on the verdict. `handle` is the contributor's, and it names
 * somebody else's point out loud. A loaded plugin normally declares both in its manifest, and the host
 * registers those through this same seam.
 */
export type PluginHookRegistry = {
  /** A point you own. The host qualifies `id` with your plugin id, so you cannot declare a point in
   *  another package's name any more than you can mount a route under one. */
  declare(point: PluginHookPoint): void
  /** A handler on a point, yours or another's. `point` is the qualified `<owner>:<id>`. A handler on a
   *  point nobody has declared, or asking for a mode its owner did not allow, is never called. */
  handle(point: string, handler: PluginHookHandler): void
  /** Run one of your own points. `id` is the bare point id. Never rejects: a handler that throws, times
   *  out or answers with the wrong shape is recorded and skipped, because every hook sits in front of
   *  something you were about to do anyway. */
  run<T extends HookPayload>(id: string, payload: T): Promise<HookVerdict<T>>
}

export type PluginHookPoint = {
  /** Unique within your plugin, and the half of the public name a contributor writes down. */
  id: string
  /** What you are opening, in your words. The trust prompt quotes it. */
  label: string
  /** The declared shape: field name to type, in the same small vocabulary a remote tree's props use.
   *  A transform's answer is checked against it, so a handler cannot turn your payload into something
   *  you never declared. */
  payload: HookPayloadShape
  /** The subset of observe | transform | veto you permit. */
  allows: readonly HookMode[]
  /** Per handler. Five seconds unless you say otherwise. */
  timeoutMs?: number
  /** Veto handlers only, and `allow` unless you say otherwise: a plugin that stalls must not brick
   *  whatever this hook guards. */
  onTimeout?: 'allow' | 'deny'
  /** `priority` reads each handler's own number first, then install time; `install` ignores it. */
  order?: 'priority' | 'install'
  /** Run every veto rather than stopping at the first, so you can show all the reasons at once. */
  collect?: boolean
}

export type PluginHookHandler = {
  /** Unique within your plugin. The host qualifies it before it leaves. */
  id: string
  mode: HookMode
  priority?: number
  /** `{ payload }` for a transform, `{ ok, reason? }` for a veto, anything at all for an observer,
   *  whose answer is dropped unread. */
  run(payload: HookPayload, signal: AbortSignal): Promise<unknown>
}

export type HookMode = 'observe' | 'transform' | 'veto'
export type HookPayloadType = 'string' | 'number' | 'boolean' | 'string[]' | 'number[]' | 'boolean[]'
export type HookPayloadShape = Record<string, HookPayloadType>
export type HookPayload = Record<string, unknown>

/** What the chain answers. `payload` is the value as the chain left it, transformed or not, so you have
 *  one thing to act on and never have to ask whether anybody changed anything. `by` is the contributing
 *  plugin, stamped by the host and never read off a handler's answer. */
export type HookVerdict<T extends HookPayload = HookPayload> = {
  ok: boolean
  payload: T
  reason?: string
  by?: string
  /** Every reason, when you declared `collect`. */
  reasons?: { reason: string; by: string }[]
}
