// Manifest routes become the same owner-bound schedule, task-check and hook registrations that
// compiled plugins make through their context. The host decides when these registrations live.
import type { Env } from '../bindings'
import { PLUGIN_NAMESPACE, reserveHostDispatchedPath } from '../routes/registry'
import type { LoadedPluginBinding } from './context'
import type { NodePluginContext, PluginHookPoint } from './types'
import { isHookMode } from './hooks'
import type { HookMode } from '@acorn/protocol/extensionPoints.ts'
import { runPluginScheduleRoute } from './scheduleRun'
import { runPluginTaskApply, runPluginTaskCheck } from './taskCheckRun'
import { runPluginHookRoute } from './hookRun'

export function registerManifestSchedules(
  ctx: Pick<NodePluginContext, 'schedules'>,
  name: string,
  binding: LoadedPluginBinding | undefined,
  requireEnv: (name: string) => Env,
): void {
  const declared = binding?.schedules ?? []
  if (declared.length === 0) return
  const env = requireEnv(name)
  for (const descriptor of declared) {
    ctx.schedules.register({
      scheduleId: descriptor.id,
      name: descriptor.name,
      cadence: descriptor.cadence,
      ...(descriptor.timeout === undefined ? {} : { timeout: descriptor.timeout }),
      run: (signal) => runPluginScheduleRoute(env, name, descriptor, signal),
    })
  }
}

export function registerManifestTaskChecks(
  ctx: Pick<NodePluginContext, 'taskChecks'>,
  name: string,
  binding: LoadedPluginBinding | undefined,
  requireEnv: (name: string) => Env,
): void {
  const declared = binding?.taskChecks ?? []
  if (declared.length === 0) return
  const env = requireEnv(name)
  for (const descriptor of declared) {
    ctx.taskChecks.register({
      id: descriptor.id,
      check: (task, signal) => runPluginTaskCheck(env, name, descriptor, task, signal),
      // An apply route exists only when the manifest declared one.
      ...(descriptor.apply === undefined
        ? {}
        : { apply: (task, signal) => runPluginTaskApply(env, name, descriptor.apply!, task, signal) }),
    })
  }
}

export function registerManifestHooks(
  ctx: Pick<NodePluginContext, 'hooks'>,
  name: string,
  binding: LoadedPluginBinding | undefined,
  requireEnv: (name: string) => Env,
): void {
  for (const point of binding?.extensionPoints ?? []) {
    if (point.kind !== 'hook' || !point.payload || !point.allows) continue
    ctx.hooks.declare({
      id: point.id,
      label: point.label,
      payload: point.payload as PluginHookPoint['payload'],
      allows: point.allows.filter(isHookMode),
      timeoutMs: point.timeoutMs,
      onTimeout: point.onTimeout,
      ...(point.order === 'priority' || point.order === 'install' ? { order: point.order } : {}),
      collect: point.collect,
    })
  }
  const handlers = (binding?.extensions ?? []).filter((entry) => entry.route !== undefined && isHookMode(entry.mode))
  if (handlers.length === 0) return
  const env = requireEnv(name)
  for (const entry of handlers) {
    ctx.hooks.handle(entry.point, {
      id: entry.id,
      mode: entry.mode as HookMode,
      priority: entry.priority,
      run: (payload, signal) => runPluginHookRoute(env, name, entry.route!, payload, signal),
    })
  }
}

/** Reserve every manifest route the host calls through a registration that holds a function rather than
 *  the path, so the HTTP door refuses an internal caller there (`reserveHostDispatchedPath`). A data
 *  source, discovery, run source, or node action carries its path, so its context seam reserves it
 *  instead, which also covers one a plugin registers from its own code. Returns the release. */
export function reserveManifestRoutes(name: string, binding: LoadedPluginBinding): () => void {
  const paths = [
    ...(binding.agentTools ?? []).map((tool) => tool.handler),
    ...(binding.contextSections ?? []).map((section) => section.read),
    ...(binding.cliCommands ?? []).map((command) => `${PLUGIN_NAMESPACE}/${name}${command.route.path}`),
    ...(binding.schedules ?? []).map((schedule) => schedule.run),
    ...(binding.taskChecks ?? []).flatMap((check) => (check.apply ? [check.check, check.apply] : [check.check])),
    ...(binding.extensions ?? []).flatMap((entry) => (entry.route ? [entry.route] : [])),
    ...(binding.harnesses ?? []).flatMap((harness) =>
      [harness.probes?.usage, harness.probes?.auth].filter((path) => path !== undefined),
    ),
  ]
  const reserved = paths.map((path) => reserveHostDispatchedPath(name, path))
  const changeRequestApi = binding.codeHost?.changeRequest?.api
  if (changeRequestApi) reserved.push(reserveHostDispatchedPath(name, changeRequestApi, true))
  return () => {
    for (const handle of reserved) handle.dispose()
  }
}
