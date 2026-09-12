// What a manifest-declared hook handler actually does when the owner reaches its decision
// (docs/plugins.md § Hooks).
//
// The same move ./taskCheckRun.ts and ./scheduleRun.ts make, for the same reason: a loaded plugin
// declares its handler as a route rather than as a function, because a manifest is data and a manifest
// is what the owner reads at install. So the node calls one of its own plugin routes with no client in
// sight, through ./dispatch.ts.
//
// It does not throw for anything a plugin can cause. A handler that 500s, answers with nonsense, or is
// not there any more has said nothing, and the chain runner already treats "said nothing" as the
// ordinary case — every hook exists in front of something the owner was about to do anyway.
import type { Env } from '../bindings'
import type { HookPayload } from '@acorn/protocol/extensionPoints.ts'
import { dispatchPluginRoute } from './dispatch'
import { createLogger } from '../telemetry/logger'

const log = createLogger('hooks')

export async function runPluginHookRoute(
  env: Env,
  pluginId: string,
  route: string,
  payload: HookPayload,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await dispatchPluginRoute(env, pluginId, route, { method: 'POST', body: JSON.stringify(payload) }, signal)
  if (!response.ok) {
    log.warn(`${pluginId} answered ${response.status} from ${route}`)
    return null
  }
  return await response.json().catch(() => null)
}
