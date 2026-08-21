// What a manifest-declared schedule actually does when it fires (docs/schedules.md).
//
// A loaded plugin declares periodic work as a route rather than as a function, because a manifest is
// data and a manifest is what the owner is shown at install. So the node has to call one of its own
// plugin routes with no client and no request in sight: ./dispatch.ts, shared with the measure
// sampler's collection reads.
import type { Env } from '../../main/bindings'
import type { PluginScheduleDescriptor } from '../../main/pluginManifest'
import { dispatchPluginRoute } from './dispatch'

/** How much of a plugin's answer reaches the run row. A schedule is not a data channel: the response is
 *  ignored beyond ok/error, and this exists only so a failing one can say why on the settings page. */
const DETAIL_MAX = 200

/** Run one manifest-declared schedule. Throws on anything that is not a 2xx, because throwing is how the
 *  engine records a failure and starts backing off. */
export async function runPluginScheduleRoute(
  env: Env,
  pluginId: string,
  descriptor: PluginScheduleDescriptor,
  signal: AbortSignal,
): Promise<string | void> {
  const response = await dispatchPluginRoute(
    env,
    pluginId,
    descriptor.run,
    { method: 'POST', body: JSON.stringify({ scheduleId: descriptor.id }) },
    signal,
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`${response.status} from ${descriptor.run}${body ? `: ${body.slice(0, DETAIL_MAX)}` : ''}`)
  }
}
