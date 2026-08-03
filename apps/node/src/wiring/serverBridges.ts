// Wires the pure-Node domain bridges that are NOT yet owned by a NodePlugin — the ones whose only
// runtime need is the DB + filesystem + a child process, not an Electron handle. Called from
// startListener (main/server.ts), so BOTH the Electron composition root and the plain-Node dev:node
// entry install them and these routes work in either. The stateful, boot-constructed bridges (harness:
// notes/memory/run/browser; terminal; workflow) are wired separately in main/bootstrap.ts and stay 503
// under dev:node. See docs/electron.md §12 (capability map).
//
// This file is one bridge away from empty. The database, docker, editor and search bridges left when
// those plugins became NodePlugins — a converted plugin fills its own bridge in init(), from a context
// that carries CoreServices instead of core's database handle. `agents` is the last one and goes the
// same way when it converts; this module is deleted then, not kept as an empty hook.
import { join } from 'node:path'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { setAgentUsageBridge } from '@acorn/plugin-agents/server/routes/usage.ts'
import { createAgentUsageService } from '@acorn/plugin-agents/main/usage/service.ts'
import { readAgentPricingPreferences } from '@acorn/plugin-agents/server/pricingStore.ts'

export function wireServerBridges(db: AppDatabase, dataDir: string): void {
  setAgentUsageBridge(createAgentUsageService({
    probeDir: join(dataDir, 'agent-usage-probe'),
    pricingForUser: (userId) => readAgentPricingPreferences(db, userId),
  }))
}
