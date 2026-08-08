# Phase 0 — Remote-URL claim seam

**Size: M.** Provider-neutral. After this phase, any plugin can declare "projects whose git
remote matches this pattern are mine to enrich," and the client can gate provider surfaces on
that claim — the way GitHub surfaces are gated today, but without GitHub being a special case
in core.

## The problem

Project facets are detected from disk in `packages/node-core/src/main/projects.ts`:
`detectProject` reads the `origin` remote and `parseGithubRemote(url)` extracts
`{ owner, name }` **only for github.com URLs**, into dedicated `projects.github_owner` /
`github_name` columns. Everything downstream that decides "show PR surfaces for this project"
keys off that GitHub facet. A SmolForge remote (`https://forge.smol.ai/alice/demo.git`, or a
self-hosted deployment on any domain) is currently just "a git project with a remote" — correct
for git operations, invisible to integrations.

The GitHub columns are fine and stay (the projects migration owns them; do not disturb its
dual-write invariants — docs/projects/README.md). What's missing is the generic version.

## Design

### Node side: provider remote claims

A new registration on the integration provider contribution
(`packages/node-core/src/server/integrations/types.ts`):

```ts
// On IntegrationProviderContribution (optional — most providers are not forges):
remoteClaim?: {
  // Decide whether a remote URL belongs to this provider and parse identity out of it.
  // Pure, synchronous, no I/O: called during detection for every project.
  parse(remoteUrl: string): { ref: string } | null
}
```

- `parse` returns a provider-scoped opaque ref (for SmolForge: `"alice/demo"`); `null` means
  not mine. HTTPS and SSH remote forms are both the provider's job to recognize.
- Self-hosted deployments make host lists dynamic: the provider reads its configured base
  URL(s) from its own connection settings at registration/refresh time, so `parse` closes over
  the current host set. A provider whose config changes re-registers (init/ready is enough —
  base-URL changes already require reconnecting the integration).

### Storage: a claims table, not new columns

Do not widen `projects` (the migration owns that table and the GitHub columns are legacy-coupled).
New core table:

```sql
CREATE TABLE project_remote_claims (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,           -- integration provider id, e.g. 'smolforge'
  ref TEXT NOT NULL,                   -- provider-scoped identity from parse()
  detected_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, provider_id)
)
```

Claims are **detected, never demanded** — recomputed by `detectProject` (which already re-probes
on folder changes and via `POST /v2/core/projects/:id/detect`): run every registered provider's
`parse` over the detected `remoteUrl`, upsert/delete rows to match. A project can be claimed by
multiple providers (mirrors exist); each row is independent. Rows are a cache of disk truth,
exactly like facets: safe to drop, rebuilt on next detection.

Migration workflow per docs/projects/README.md practical notes (schema.ts →
`pnpm --filter @acorn/node-core db:generate` → replay check).

### API and client

- Project read payloads (`/v2/core/projects` and wherever facets are serialized) gain
  `claims: { providerId, ref }[]`.
- Client-side gating predicate, provider-neutral, next to where sources are gated on connected
  integrations today (`packages/client-core/src/registries/sources.ts` consumers): *show a
  provider's project-scoped surfaces iff the project has a claim for that provider AND the
  integration is connected*. GitHub's existing gating is left alone in this phase; converging it
  onto claims is a later cleanup, noted, not required.
- Cache note: project payloads are persisted in the renderer's IndexedDB query cache with no
  buster — adding an **optional** field is safe; do not make `claims` required on the persisted
  type without bumping the query key (docs/projects/README.md, client cache gotcha).

## Why not URL-pattern strings in the manifest instead of a parse function?

Declarative patterns (`"*.smol.ai"`) were considered and rejected: remote identity parsing is
genuinely provider-specific (SSH forms, subpaths, `.git` suffixes, self-hosted hosts known only
from connection config), and a wrong parse yields wrong refs silently. A pure function in the
provider is testable and exact. The cost — claims only exist while the plugin is enabled — is
correct behavior anyway: rows for disabled providers are stale cache, and re-detection prunes
them.

## Steps

1. Add `remoteClaim` to `IntegrationProviderContribution`; registry exposes
   `claimsFor(remoteUrl)` iterating registered providers.
2. Schema + migration for `project_remote_claims`.
3. Wire into `detectProject` / `reconcile` paths in `main/projects.ts` (claims recompute wherever
   facets recompute; same triggers, same idempotence).
4. Serialize claims on project reads; extend protocol types (optional field).
5. Client gating predicate + expose through the plugin-api client surface so plugin UI can ask
   "is this project mine".
6. Tests: parse-registration round-trip; multi-provider claims on one remote; claim pruning when
   a provider disappears or the remote changes; detection idempotence (copy the model of
   existing facet tests in `packages/node-core/src/main/projects.test.ts`).

## Exit criteria

- A test provider claiming `example.test` remotes gets rows created/pruned by detection, sees
  its claim on project reads, and a client predicate gates on it.
- No `projects` column changes; projects-migration tests and dual-write invariants untouched.
- Zero provider names in core code or schema (provider id is data).
- `pnpm lint`, suites, boundaries test green.
