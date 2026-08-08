// Rung 1 of the containment ladder (docs/third-party/node-security.md): a loaded plugin's
// NodePluginContext is built from its manifest's `permissions.node` block instead of being handed
// the full context a built-in gets.
//
// Be precise about what this is. It is LEAST PRIVILEGE FOR COOPERATIVE CODE: it stops honest plugins
// over-reaching by accident, it makes phase 5's trust prompt truthful for the well-behaved majority,
// and it trains authors to write minimal manifests — which matters because rung 2 turns these same
// declarations into hard grants, and manifests that were always minimal migrate without breaking.
// It is NOT a security boundary: a loaded bundle shares the Node's process and can `import('node:fs')`
// or open core.sqlite and ignore `ctx` entirely. Only moving plugins out of process changes that.
//
// Two rules the whole file follows:
//   - Gate by OMISSION, never by throwing. An absent facet fails with a TypeError the author sees the
//     first time they run it, and the runtime shape of `ctx` becomes the documentation of the grant.
//   - Keep the facet→permission mapping HERE, in one module, with exhaustive tests. A grant decided
//     in two places is a grant nobody can audit.
import type { CoreServices } from './core'
import type { ProjectService } from './core/projects'
import type { CapabilityId, CapabilityRegistry } from '../server/plugin/capabilities'
import type { NodePermissions } from './pluginManifest'

// What `projects:read` grants. `checkouts()` is in here, and it returns the local filesystem path of
// EVERY mapped project on the machine — where the user keeps their code, how many codebases they
// have, often their employer's project names. "Read projects" does not sound like that, so phase 5's
// trust prompt has to name the disclosure explicitly.
const PROJECT_READS = ['byId', 'byGithub', 'checkouts', 'config', 'assertConfigTrusted', 'setup'] as const
const PROJECT_WRITES = ['create', 'update'] as const

// Facet token → CoreServices key, for the facets that map one to one. `secrets` and `proc` are
// deliberately absent: they come from their own manifest booleans (`secrets`, `exec`) rather than
// from this list, because they are the two asks a reviewer should have to see spelled out.
//
// `git` is granted independently of `exec`, and that split is cosmetic rather than real: core/vcs/git
// is a thin wrapper over the same runProcess the broker exposes, so `git` without `exec` still means
// "can run a git subprocess". It stays separate because "reads this repo's history" and "runs
// arbitrary commands" are different things to disclose, not because one contains the other.
const SIMPLE_FACETS = {
  fs: 'fs',
  git: 'git',
  tasks: 'tasks',
  context: 'context',
  models: 'models',
  prefs: 'prefs',
  identity: 'identity',
} as const satisfies Record<string, keyof CoreServices>

const pick = <T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>

// The returned object is TYPED as a full CoreServices and is not one. That is deliberate: widening
// NodePluginContext['core'] to a partial would make every facet optional for the fifteen built-in
// plugins that legitimately have all of them, to describe a shape only loaded plugins see. The lie
// is contained to this one cast, and the failure mode it produces — a TypeError on the first call to
// an undeclared facet — is exactly the one this module is trying to produce.
export function scopeCore(core: CoreServices, permissions: NodePermissions): CoreServices {
  const granted: Partial<CoreServices> = {}
  for (const token of permissions.core) {
    const simple = SIMPLE_FACETS[token as keyof typeof SIMPLE_FACETS]
    if (simple) {
      // Assigning through the union of facet types needs the widening; each key takes its own value.
      Object.assign(granted, { [simple]: core[simple] })
      continue
    }
    // `projects:write` implies read. A caller that may create and update a project but not resolve
    // one by id cannot do anything useful, and pretending otherwise would just make every importer
    // declare both tokens.
    if (token === 'projects:read' || token === 'projects:write') {
      const keys: readonly (keyof ProjectService)[] =
        token === 'projects:write' ? [...PROJECT_READS, ...PROJECT_WRITES] : PROJECT_READS
      granted.projects = { ...granted.projects, ...pick(core.projects, keys) } as ProjectService
    }
    // Anything else is a facet this acorn does not have. Ignored rather than rejected: a manifest
    // naming a facet from a newer build should lose that one grant, not fail to load.
  }
  // Use-scoped credential access. There is deliberately no "read this secret" call anywhere on the
  // public surface, so this grant cannot widen into one later.
  if (permissions.secrets) granted.secrets = core.secrets
  if (permissions.exec) granted.proc = core.proc
  return granted as CoreServices
}

// Undeclared capability ids read as absent, which is indistinguishable from the providing plugin
// being disabled — a state every consumer already has to degrade around (docs/plugins.md). `require`
// keeps throwing, because a loaded plugin calling `require` on something it never declared is a bug
// in the plugin, and a loud one is better than a silent undefined.
//
// `provide` is NOT filtered: exporting a capability is a contribution, not an access grant, and the
// host binds nothing to the plugin's name through it that the plugin could not already publish.
export function scopeCapabilities(
  registry: CapabilityRegistry,
  declared: readonly string[],
): Pick<CapabilityRegistry, 'provide' | 'get' | 'require' | 'ids'> {
  const allowed = new Set(declared)
  return {
    provide: (id, impl) => registry.provide(id, impl),
    get: <T>(id: CapabilityId<T>) => (allowed.has(id) ? registry.get(id) : undefined),
    require: <T>(id: CapabilityId<T>): T => {
      const impl = allowed.has(id) ? registry.get(id) : undefined
      if (impl === undefined) throw new Error(`Required capability not provided: ${id}`)
      return impl
    },
    ids: () => registry.ids().filter((id) => allowed.has(id)),
  }
}
