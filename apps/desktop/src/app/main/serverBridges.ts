// Wires the pure-Node domain bridges — the ones whose only runtime need is the DB + filesystem +
// a child process (ripgrep, git, pg), not an Electron handle. Called from startListener (main/
// server.ts), so BOTH the Electron composition root and the plain-Node dev:node entry install them
// and these routes work in either. The stateful, boot-constructed bridges (harness: notes/memory/
// run/browser; terminal; workflow) are wired separately in main/bootstrap.ts and stay 503 under
// dev:node. See docs/electron.md §12 (capability map).
import { join } from 'node:path'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { setAgentUsageBridge } from '@acorn/plugin-agents/server/routes/usage.ts'
import { setDatabaseBridge } from '@acorn/plugin-database/server/routes/database.ts'
import { setDockerBridge } from '@acorn/plugin-docker/server/routes/docker.ts'
import { setEditorBridge } from '@acorn/plugin-editor/server/routes/editor.ts'
import { setLocalGitBridge } from '@acorn/plugin-changes/server/routes/localGit.ts'
import { setSearchBridge } from '@acorn/plugin-editor/server/routes/search.ts'
import { databaseBridge } from '@acorn/plugin-database/main/database.ts'
import { dockerBridge } from '@acorn/plugin-docker/main/dockerBridge.ts'
import { registerDockerWsChannel } from '@acorn/plugin-docker/main/wsChannel.ts'
import { editorBridge } from '@acorn/plugin-editor/main/editor.ts'
import { localGitBridge } from '@acorn/plugin-changes/main/localGit.ts'
import { searchBridge } from '@acorn/plugin-editor/main/search.ts'
import { createAgentUsageService } from '@acorn/plugin-agents/main/usage/service.ts'
import { readAgentPricingPreferences } from '@acorn/plugin-agents/server/pricingStore.ts'

export function wireServerBridges(db: AppDatabase, dataDir: string): void {
  setAgentUsageBridge(createAgentUsageService({
    probeDir: join(dataDir, 'agent-usage-probe'),
    pricingForUser: (userId) => readAgentPricingPreferences(db, userId),
  }))
  setSearchBridge(searchBridge(db))
  setEditorBridge(editorBridge(db))
  setLocalGitBridge(localGitBridge(db))
  setDatabaseBridge(databaseBridge(db))
  setDockerBridge(dockerBridge(db))
  registerDockerWsChannel()
}
