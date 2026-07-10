// Wires the run bridge (docs/workflows.md §2): the RuntimeService behind the renderer's run routes
// (server/routes/harness.ts). Notes, memory and the drivable browser moved to the agent-tool
// registry in the agent-tool registry (main/agentToolsWiring.ts); run keeps a dedicated bridge because its renderer
// surface (run pane, preview home) is not an agent tool. Wired independently so dev:node stays 503.
import { setRunBridge } from '../../core/server/routes/harness'
import type { RuntimeService } from '../../plugins/terminal/main/runtime'

export function wireRunBridge(runtime: RuntimeService): void {
  setRunBridge({
    targets: (taskId) => runtime.targets(taskId),
    start: (taskId, targetId) => runtime.start(taskId, targetId),
    stop: (taskId, targetId) => runtime.stop(taskId, targetId),
    restart: (taskId, targetId) => runtime.restart(taskId, targetId),
    status: (taskId, targetId) => runtime.status(taskId, targetId),
    defaultUrl: (taskId) => runtime.defaultUrl(taskId),
  })
}
