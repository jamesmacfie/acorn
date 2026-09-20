// The plugin half of the deadlock test in ../pluginRpc.test.ts. A real worker thread, because the
// bug it pins only exists across threads: on one thread the caller's spin loop drains the port by
// hand and the queue never gets a chance to hold anything up.
import { workerData, type MessagePort } from 'node:worker_threads'
import { PluginRpcEndpoint } from '../pluginRpc.ts'

const { port } = workerData as { port: MessagePort }
// The same split nodePluginWorker draws: route handlers cross as promises, pure leaves cross
// synchronously.
const endpoint = new PluginRpcEndpoint(port, (path) => (path.endsWith('.pure') ? 'sync' : 'async'))

port.postMessage(
  await endpoint.encode(
    {
      // Stands in for a plugin route handler that needs something back from the host, the way
      // linear's fetch handler waits on ctx.core.projects.
      slow: async (waitOnHost: () => Promise<void>) => {
        await waitOnHost()
        return 'slow'
      },
      pure: () => 'pure',
      // A second route that has nothing to do with the first. It must answer while `slow` is still
      // waiting.
      quick: async () => 'quick',
    },
    'plugin',
  ),
)
