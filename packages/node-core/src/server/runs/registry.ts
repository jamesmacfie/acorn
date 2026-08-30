import { runsResponseSchema, type RunRow } from '@acorn/protocol/runs.ts'
import type { Env } from '../bindings'
import { dispatchPluginRoute } from '../pluginHost/dispatch'

// The unified run list's node half (@acorn/protocol/runs.ts explains why this is a registry and what
// would justify a core table instead).
//
// Shaped like the collection-read registry beside it, and for the same reason: a plugin declares a
// route, the host calls it with no client and no request in sight, and the answer is parsed and
// stamped here. Nothing joins, nothing migrates, and neither producer knows the other exists.

/** Where one plugin's runs can be read from the node. */
export type RunSource = {
  pluginId: string
  /** `GET` → `{ runs }`. Confined to the plugin's own namespace on every call, not merely at
   *  registration (../plugin/dispatch.ts). */
  runs: string
}

/** What a plugin hands `ctx.runs.register`. The host binds `pluginId`, so a plugin cannot file its
 *  runs under a stranger's name. */
export type RunSourceRegistration = Omit<RunSource, 'pluginId'>

// A module singleton, like the route, collection and node-action registries beside it, with the same
// lifecycle answer: the host clears a plugin's entries before re-registering them.
const sources = new Map<string, RunSource>()

export function registerRunSource(source: RunSource): void {
  const clash = sources.get(source.pluginId)
  if (clash && clash.runs !== source.runs) {
    throw new Error(`Duplicate run source for '${source.pluginId}': already registered for ${clash.runs}, now for ${source.runs}.`)
  }
  sources.set(source.pluginId, source)
}

export function clearRunSources(pluginId: string): void {
  sources.delete(pluginId)
}

export const runSources = (): RunSource[] =>
  [...sources.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId))

/** How long one source may take before the merge gives up on it. A run list is something a person is
 *  waiting on, and one slow plugin must not decide how long everyone waits. */
const SOURCE_TIMEOUT_MS = 2_000

/** Every run this node knows about, newest first.
 *
 * A source that throws, times out, or answers with something that will not parse contributes nothing
 * and does not fail the call. That asymmetry is deliberate and it is the opposite of the collection
 * sampler's: a measurement with a missing source is a wrong number, while a run list with a missing
 * source is a shorter list, and refusing to show the eight runs you can see because a ninth source is
 * wedged helps nobody. `failed` names who could not answer, so the shortfall is visible rather than
 * silent. */
export async function readRuns(env: Env): Promise<{ runs: RunRow[]; failed: string[] }> {
  const failed: string[] = []
  const answers = await Promise.all(runSources().map(async (source): Promise<RunRow[]> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS)
    try {
      const response = await dispatchPluginRoute(env, source.pluginId, source.runs, { method: 'GET' }, controller.signal)
      if (!response.ok) throw new Error(`${response.status} from ${source.runs}`)
      const parsed = runsResponseSchema.safeParse(await response.json())
      if (!parsed.success) throw new Error(`${source.runs} did not answer with a run list`)
      // Provenance is the host's. A row never names its own source, even when the source is right.
      return parsed.data.runs.map((run) => ({ ...run, pluginId: source.pluginId }))
    } catch (error) {
      console.warn(`[runs] ${source.pluginId} could not answer:`, error)
      failed.push(source.pluginId)
      return []
    } finally {
      clearTimeout(timer)
    }
  }))
  // Newest first, ties broken by owner then id so two runs started in the same millisecond do not
  // swap places between reads.
  const runs = answers.flat().sort((a, b) =>
    b.startedAt - a.startedAt || a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id))
  return { runs, failed: failed.sort() }
}
