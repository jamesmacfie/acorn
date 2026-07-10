// Wires the pure-Node domain bridges — the ones whose only runtime need is the DB + filesystem +
// a child process (ripgrep, git, pg), not an Electron handle. Called from startListener (main/
// server.ts), so BOTH the Electron composition root and the plain-Node dev:node entry install them
// and these routes work in either. The stateful, boot-constructed bridges (harness: notes/memory/
// run/browser; terminal; workflow) are wired separately in main/bootstrap.ts and stay 503 under
// dev:node. See docs/next Phase 3 §6 (capability map).
import type { AppDatabase } from '../server/db'
import { setDatabaseBridge } from '../server/routes/database'
import { setEditorBridge } from '../server/routes/editor'
import { setLocalGitBridge } from '../server/routes/localGit'
import { setSearchBridge } from '../server/routes/search'
import { databaseBridge } from './database'
import { editorBridge } from './editor'
import { localGitBridge } from './localGit'
import { searchBridge } from './search'

export function wireServerBridges(db: AppDatabase): void {
  setSearchBridge(searchBridge(db))
  setEditorBridge(editorBridge(db))
  setLocalGitBridge(localGitBridge(db))
  setDatabaseBridge(databaseBridge(db))
}
