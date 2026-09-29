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
}
