import type { TreeWorkerKey } from './workerHost'

// Distribution withdraws a plugin's workers synchronously when its selection goes, but the worker host
// loads only when a loaded plugin's tree first draws. So the host installs its teardown here as it loads.
// Every worker lives in the host's own table, so until then there is no worker to stop.
let teardown: ((key: TreeWorkerKey, reason: string) => void) | undefined

export function installTreeWorkerTeardown(stop: (key: TreeWorkerKey, reason: string) => void): void {
  teardown = stop
}

/** Stop every worker running this exact plugin identity, in this tick. */
export function stopTreeWorkers(key: TreeWorkerKey, reason: string): void {
  teardown?.(key, reason)
}
