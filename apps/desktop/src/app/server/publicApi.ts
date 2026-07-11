import type { AppDatabase } from '../../core/server/db'
import type { PluginApiContribution } from '../../core/server/publicApi/defineEndpoint'
import { LocalGitService } from '../../plugins/changes/main/localGitService'
import { buildChangesPublicApi } from '../../plugins/changes/server/publicApi'
import { databaseBridge } from '../../plugins/database/main/database'
import { buildDatabasePublicApi } from '../../plugins/database/server/publicApi'
import { GitHubPublicService } from '../../plugins/github/server/publicService'
import { buildGithubPublicApi } from '../../plugins/github/server/publicApi'
import { editorBridge } from '../../plugins/editor/main/editor'
import { searchBridge } from '../../plugins/editor/main/search'
import { buildEditorPublicApi } from '../../plugins/editor/server/publicApi'
import { LinearService } from '../../plugins/linear/server/linearService'
import { buildLinearPublicApi } from '../../plugins/linear/server/publicApi'
import type { MemoryProposalStore } from '../../plugins/memory/main/memoryProposals'
import { MemoryService } from '../../plugins/memory/main/memoryService'
import { buildMemoryPublicApi } from '../../plugins/memory/server/publicApi'
import type { NotesStore } from '../../plugins/notes/main/notes'
import { buildNotesPublicApi } from '../../plugins/notes/server/publicApi'
import { buildPreviewPublicApi } from '../../plugins/preview/server/publicApi'
import { buildRollbarPublicApi } from '../../plugins/rollbar/server/publicApi'
import { RepoCheckoutService } from '../../plugins/terminal/main/checkoutService'
import { TerminalProfilesService } from '../../plugins/terminal/main/profilesService'
import { TerminalSessionService } from '../../plugins/terminal/main/sessionService'
import { CommandExecutionService } from '../../plugins/terminal/main/executionService'
import { WorktreeService } from '../../plugins/terminal/main/worktreeService'
import { buildTerminalPublicApi } from '../../plugins/terminal/server/publicApi'
import { buildRunTargetsContribution } from '../../plugins/terminal/server/runTargets'
import { WorkflowService, type WorkflowRunnerLike } from '../../plugins/workflows/main/workflowService'
import { buildWorkflowsPublicApi } from '../../plugins/workflows/server/publicApi'

// Composition leaf for built-in public API plugin contributions (docs/public-api.md
// §1). The main composition root constructs the plugin services and calls this to assemble the
// contribution list handed to AutomationApiServer. Core owns the registry/transport; plugins own
// their resources.

export type PublicApiPluginDeps = {
  db: AppDatabase
  encKey: string
  blobs: { get(key: string): Promise<string | null> }
  resolveGithubToken: (userId: string) => Promise<string | null>
  notesStore: NotesStore
  memoryProposals: MemoryProposalStore
  memoryReconcile: () => Promise<void>
  workflowRunner: WorkflowRunnerLike
}

export function buildPublicApiContributions(deps: PublicApiPluginDeps): { owner: string; contribution: PluginApiContribution }[] {
  return [
    { owner: 'notes', contribution: buildNotesPublicApi(deps.notesStore) },
    { owner: 'changes', contribution: buildChangesPublicApi(new LocalGitService(deps.db)) },
    { owner: 'editor', contribution: buildEditorPublicApi(editorBridge(deps.db), searchBridge(deps.db)) },
    {
      owner: 'memory',
      contribution: buildMemoryPublicApi(new MemoryService({ db: deps.db, proposals: deps.memoryProposals, reconcile: deps.memoryReconcile })),
    },
    { owner: 'database', contribution: buildDatabasePublicApi(databaseBridge(deps.db)) },
    { owner: 'workflows', contribution: buildWorkflowsPublicApi(new WorkflowService(deps.db, deps.workflowRunner)) },
    { owner: 'rollbar', contribution: buildRollbarPublicApi(deps.db, deps.encKey) },
    { owner: 'linear', contribution: buildLinearPublicApi(new LinearService(deps.db, deps.encKey)) },
    { owner: 'terminal', contribution: buildTerminalPublicApi(new CommandExecutionService(deps.db), new WorktreeService(deps.db), new RepoCheckoutService(deps.db), new TerminalProfilesService(), new TerminalSessionService()) },
    { owner: 'terminal', contribution: buildRunTargetsContribution() },
    { owner: 'github', contribution: buildGithubPublicApi(new GitHubPublicService({ db: deps.db, blobs: deps.blobs, resolveToken: deps.resolveGithubToken })) },
    { owner: 'preview', contribution: buildPreviewPublicApi(deps.db) },
  ]
}
