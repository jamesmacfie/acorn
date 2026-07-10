// Wires the pure-Node domain bridges — the ones whose only runtime need is the DB + filesystem +
// a child process (ripgrep, git, pg), not an Electron handle. Called from startListener (main/
// server.ts), so BOTH the Electron composition root and the plain-Node dev:node entry install them
// and these routes work in either. The stateful, boot-constructed bridges (harness: notes/memory/
// run/browser; terminal; workflow) are wired separately in main/bootstrap.ts and stay 503 under
// dev:node. See docs/electron.md §12 (capability map).
import type { AppDatabase } from '../../core/server/db'
import { setDatabaseBridge } from '../../plugins/database/server/routes/database'
import { setEditorBridge } from '../../plugins/editor/server/routes/editor'
import { setLocalGitBridge } from '../../plugins/changes/server/routes/localGit'
import { setSearchBridge } from '../../plugins/editor/server/routes/search'
import { databaseBridge } from '../../plugins/database/main/database'
import { editorBridge } from '../../plugins/editor/main/editor'
import { localGitBridge } from '../../plugins/changes/main/localGit'
import { searchBridge } from '../../plugins/editor/main/search'

export function wireServerBridges(db: AppDatabase): void {
  setSearchBridge(searchBridge(db))
  setEditorBridge(editorBridge(db))
  setLocalGitBridge(localGitBridge(db))
  setDatabaseBridge(databaseBridge(db))
}
