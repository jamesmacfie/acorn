// What a plugin has to say about a task the owner is about to archive, and the cleanup they may opt
// into (docs/plugins.md § Task checks: why this lives node-side, and why a concern carries no
// callback).
import type { TaskArchiveConcern } from '@acorn/protocol/terminal.ts'
import type { TaskRef } from '../../main/core'

/** How long one check may take before the fan-out gives up on it (docs/plugins.md § Task checks). */
export const CHECK_TIMEOUT_MS = 2_000

/** How long a cleanup may take once the owner has opted in (docs/plugins.md § Task checks). An order
 *  of magnitude below main/archive.ts's TEARDOWN_TIMEOUT_MS, which runs alongside it. */
export const APPLY_TIMEOUT_MS = 60_000

/** How much of a plugin's own text reaches the dialog. Display-only strings, capped by the node, the
 *  same treatment a loaded plugin's failure `reason` gets on its way to the roster. */
const MESSAGE_MAX = 200
const DETAIL_MAX = 300
const LABEL_MAX = 80
/** The dialog draws a list, not a file tree. Five is what fits above the buttons without the concern
 *  rows pushing the confirm out of reach; the rest is a count. */
export const DETAILS_MAX = 5

export type TaskConcern = {
  /** Unique within the check. The host qualifies it with the plugin and check ids before it leaves. */
  id: string
  message: string
  /** The plugin's to declare, unlike a context-menu `tone` (docs/plugins.md § Task checks: this is a
   *  claim about the plugin's own data, not a core resource). */
  severity: 'warn' | 'danger'
  /** Up to five lines under the message: changed paths, container names. */
  details?: string[]
  /** What the plugin knows it did not send, so the host draws "+7 more" and no plugin has to invent
   *  that string for itself. */
  detailsMore?: number
  /** Absent = advisory. Present = a checkbox, and `apply` runs if it is still ticked on confirm. A
   *  concern that offers one from a check with no `apply` is refused below rather than drawn: a
   *  checkbox that does nothing is worse than no checkbox. */
  action?: { label: string; checked: boolean }
}

export type TaskCheck = {
  /** Unique within the plugin, and stable: it is half of the id the client hands back to say which
   *  cleanups the owner accepted. */
  id: string
  /** Answers for one task, or `null` when it has nothing to say, which is the common case and must
   *  stay cheap. The signal fires at CHECK_TIMEOUT_MS. */
  check(task: TaskRef, signal: AbortSignal): Promise<TaskConcern | null>
  /** Run at archive time, once, for a concern whose checkbox the owner left ticked. */
  apply?(task: TaskRef, signal: AbortSignal): Promise<void>
}

/** A check as the registry holds it: the plugin's declaration plus the owner the host bound. */
export type RegisteredTaskCheck = TaskCheck & { pluginId: string }

/** One concern on its way to the client. The wire shape is the protocol's, because the dialog is the
 *  consumer; what this module adds is the guarantee that `id` and `pluginId` were minted here and not
 *  read off a plugin's answer. */
export type WireTaskConcern = TaskArchiveConcern

const key = (pluginId: string, checkId: string): string => `${pluginId}:${checkId}`

/** `<pluginId>:<checkId>:<concernId>`. Minted here and parsed here, so the string the client hands
 *  back on archive can only ever name a check the host registered. */
export const qualifiedConcernId = (pluginId: string, checkId: string, concernId: string): string =>
  `${pluginId}:${checkId}:${concernId}`

// A module singleton, like the route, collection and node-action registries beside it, with the same
// lifecycle answer: the plugin host clears a plugin's entries before re-registering them
// (./host.ts § clearRegistrations). That is the disposal the old client seam did not have.
const checks = new Map<string, RegisteredTaskCheck>()

export function registerTaskCheck(check: RegisteredTaskCheck): void {
  const id = key(check.pluginId, check.id)
  if (checks.has(id)) throw new Error(`Duplicate task check '${id}'.`)
  checks.set(id, check)
}

export function clearTaskChecks(pluginId: string): void {
  for (const [id, check] of checks) if (check.pluginId === pluginId) checks.delete(id)
}

export const taskChecks = (): RegisteredTaskCheck[] =>
  [...checks.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id))

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null

/**
 * What a check said, reduced to what the host is willing to draw.
 *
 * Per-field rather than all-or-nothing, matching how the client sanitises plugin chrome
 * (client-core/plugins/chrome/data.ts): a concern with one unusable detail loses the detail, not the
 * warning. `null` means there is nothing here worth a row: no message, or a check that answered with
 * something that is not a concern at all.
 */
export function sanitizeConcern(pluginId: string, checkId: string, value: unknown, canApply: boolean): WireTaskConcern | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const message = text(raw.message, MESSAGE_MAX)
  const concernId = text(raw.id, 64)
  if (!message || !concernId) return null
  const details = (Array.isArray(raw.details) ? raw.details : [])
    .flatMap((entry) => {
      const line = text(entry, DETAIL_MAX)
      return line ? [line] : []
    })
    .slice(0, DETAILS_MAX)
  const more = typeof raw.detailsMore === 'number' && Number.isInteger(raw.detailsMore) && raw.detailsMore > 0
    ? raw.detailsMore
    : 0
  // A checkbox is only drawn when there is something behind it. A check with no `apply` that asks for
  // one is offering the owner a decision the host cannot honour.
  const rawAction = canApply && raw.action && typeof raw.action === 'object' ? raw.action as Record<string, unknown> : null
  const label = rawAction ? text(rawAction.label, LABEL_MAX) : null
  return {
    id: qualifiedConcernId(pluginId, checkId, concernId),
    pluginId,
    message,
    severity: raw.severity === 'danger' ? 'danger' : 'warn',
    ...(details.length ? { details } : {}),
    ...(more ? { detailsMore: more } : {}),
    ...(label ? { action: { label, checked: rawAction!.checked !== false } } : {}),
  }
}

/**
 * One check, bounded and contained. Resolves to `null` for a check that was slow, threw, or answered
 * with something unusable. A plugin cannot stop the owner archiving a task by being broken.
 *
 * The deadline races the check rather than merely signaling an abort. The signal is a courtesy: a
 * check that watches it can stop early, but most checks ignore it, and an ignored signal would leave
 * this promise pending forever and hold the dialog open with it. The abandoned work still runs to
 * completion in the background; the deadline only guarantees that nobody is waiting for it.
 */
function runOne(check: RegisteredTaskCheck, task: TaskRef): Promise<WireTaskConcern | null> {
  return new Promise<WireTaskConcern | null>((resolve) => {
    const controller = new AbortController()
    let settled = false
    const finish = (concern: WireTaskConcern | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(concern)
    }
    const timer = setTimeout(() => {
      if (settled) return
      controller.abort()
      console.warn(`[task-check] ${check.pluginId}:${check.id} did not answer within ${CHECK_TIMEOUT_MS}ms`)
      finish(null)
    }, CHECK_TIMEOUT_MS)
    Promise.resolve(check.check(task, controller.signal)).then((answer) => {
      if (answer === null || answer === undefined) return finish(null)
      const concern = sanitizeConcern(check.pluginId, check.id, answer, check.apply !== undefined)
      if (!concern) console.warn(`[task-check] ${check.pluginId}:${check.id} returned an unusable concern:`, answer)
      finish(concern)
    }).catch((error) => {
      console.warn(`[task-check] ${check.pluginId}:${check.id} failed:`, error)
      finish(null)
    })
  })
}

/** Every plugin's answer for one task, in registry order. Never rejects. */
export async function collectTaskConcerns(task: TaskRef): Promise<WireTaskConcern[]> {
  const answers = await Promise.all(taskChecks().map((check) => runOne(check, task)))
  return answers.filter((concern): concern is WireTaskConcern => concern !== null)
}

/**
 * Run the cleanups the owner accepted, by qualified concern id.
 *
 * Ids are matched against the registry, never trusted as a route: an id naming a check this node does
 * not have is dropped, which is also what happens when the owner archives from a stale dialog after
 * disabling the plugin. Each apply is bounded and contained for the same reason a check is: a
 * cleanup that hangs must not hold the archive open. The names that failed come back so the caller
 * can report them instead of reporting a clean archive.
 */
export async function applyTaskChecks(task: TaskRef, ids: readonly string[]): Promise<string[]> {
  const wanted = new Set(ids)
  const failures: string[] = []
  for (const check of taskChecks()) {
    const prefix = `${key(check.pluginId, check.id)}:`
    if (!check.apply || ![...wanted].some((id) => id.startsWith(prefix))) continue
    // Raced, not merely aborted, for the reason runOne states: an ignored signal would hold the
    // archive open indefinitely, and the archive is the thing the owner asked for.
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve('timeout')
      }, APPLY_TIMEOUT_MS)
    })
    try {
      if (await Promise.race([check.apply(task, controller.signal).then(() => 'done' as const), deadline]) === 'timeout') {
        console.warn(`[task-check] ${check.pluginId}:${check.id} cleanup did not finish within ${APPLY_TIMEOUT_MS}ms`)
        failures.push(check.pluginId)
      }
    } catch (error) {
      console.warn(`[task-check] ${check.pluginId}:${check.id} cleanup failed:`, error)
      failures.push(check.pluginId)
    } finally {
      clearTimeout(timer)
    }
  }
  return failures
}
