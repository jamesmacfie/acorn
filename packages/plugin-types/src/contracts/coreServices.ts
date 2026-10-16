import type { CoreDataService } from './coreData.js'
import type { CoreFsService, CoreGitService, CoreProcService, CoreSecretService } from './coreSystem.js'
import type { CoreTaskService } from './coreTasks.js'
import type { CoreProjectService } from './coreProjects.js'
import type { CoreContextService, CoreIdentityService, CoreModelService, CorePrefService } from './coreMisc.js'
import type { CoreTelemetryService } from './telemetry.js'

// ── Core services ─────────────────────────────────────────────────────────────────────────────────

/** Path confinement, git, the process broker, use-scoped credentials and the core read models. A
 *  plugin reaches core through this rather than deep-importing anything.
 *
 * Every facet is gated by `permissions.node` in the manifest, and the object you receive holds only the
 * ones you asked for. The type says otherwise on purpose: describing a shape only loaded plugins see
 * would make every facet optional for the compiled plugins that have all of them. */
export type CoreServices = {
  /** Available with the `agent-tool-provenance` permission. */
  agentToolProvenance?: {
    verify(input: { taskId: string; sessionId: string; tool: string; proof: string }): boolean | Promise<boolean>
  }
  fs: CoreFsService
  git: CoreGitService
  proc: CoreProcService
  secrets: CoreSecretService
  tasks: CoreTaskService
  context: CoreContextService
  models: CoreModelService
  data: CoreDataService
  prefs: CorePrefService
  identity: CoreIdentityService
  projects: CoreProjectService
  telemetry: CoreTelemetryService
  /** The ids of the running plugins that declare a code host, such as `github`. Available with
   *  `projects:read`. */
  codeHosts(): string[]
  /** What a running code host is called as a person reads it, such as `GitLab`, or null when no running
   *  plugin with that id declares one. Available with `projects:read`. */
  codeHostLabel(pluginId: string): string | null
}
