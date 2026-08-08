# Phase 3 — GitHub as importer + de-defaulting (IMPLEMENTED; completed record)

Prerequisite: Phase 2 (project-based task creation and the Projects manager UI must exist —
the import wizard lands projects into that surface).

GitHub's remaining privileges after Phase 2 are structural leftovers, not features. This phase
removes each one and gives GitHub its proper role: an **importer** (discover → clone/map) and the
**PR viewer**.

## Inventory of remaining special-casing (verified at exploration time)

| Special case | Location | Action |
| --- | --- | --- |
| `repoMirrorSource` core slot | `packages/node-core/src/server/repoMirror.ts`; filled by `plugins/github/src/node/index.ts` | delete the slot |
| Bootstrap auto-assigns mirrored repos | `packages/node-core/src/server/routes/workspaces.ts` `POST /bootstrap` | shrink to "ensure Default workspace exists" |
| Default-branch reads via mirror | `packages/node-core/src/server/routes/taskContext.ts` (~:26), `packages/node-core/src/server/agentTools/coreTools.ts` (~:91) | read `projects.default_branch` |
| DELETE guard on the github integration | `packages/node-core/src/server/routes/integrations.ts` (~:97, literal `id === 'github'`) | remove |
| `required: true` on both plugin halves | `plugins/github/src/node/index.ts` (~:36), `plugins/github/src/client/index.ts` (~:17) | flip to false; update the pinned list in `apps/desktop/test/client/clientPluginDisable.test.ts` (~:135: `['agents','github','memory','notes','terminal']`) |
| GitHub rail source is default + ungated | `plugins/github/src/client/index.ts` (~:29): `order:10`, `isDefault:true`, NO `providerId` | remove `isDefault`, add `providerId:'github'` so `availableSources` (`packages/client-core/src/tabs/sources.ts`) hides it when disconnected; core contributes the default home source |
| Client repo-list seam | `repositorySource()` in `packages/client-core/src/registries/sources.ts` (~:101); sole impl `plugins/github/src/client/repositoryContribution.ts`; `SourceRepo` carries a numeric GitHub id | delete the seam — the shell's picker is project-based after Phase 2; GitHub's repo list moves inside its import wizard |
| `GITHUB_CLIENT_ID`/`SECRET` core bindings | `packages/node-core/src/main/bindings.ts` (~:49-54, :225-228); baked in `apps/desktop/src/app/main/electron.ts` (~:49-50) | move into plugin-owned config; `GITHUB_CLIENT_SECRET` is already dead (nothing reads it — the device grant needs no secret) and can just be deleted, pending the owner's note in bindings.ts |
| Onboarding lists only mirrored repos | `plugins/onboarding/src/client/OnboardingModal.tsx` renders the (Phase 2) Projects manager | copy change: GitHub presented as "connect to import repos + review PRs", not step one |

## The import wizard

New surface owned by the github plugin (client + server):

- **Server**: `POST /v2/p/github/import` — body: a list of selected remote repos with a chosen
  action each:
  - `map`: user picked an existing local folder → call core's `createProject` (via a
    CoreServices seam or loopback to `/v2/core/projects`), then stamp `github_repo_id` from the
    mirror row (the facet owner/name comes from detection; the numeric id only the API knows).
  - `clone`: `git clone <url> <parentDir>/<name>` (through `core.git` — the one git seam, which
    already sets `GIT_TERMINAL_PROMPT=0`; a clone needing credentials must fail fast, not hang),
    then `createProject` on the result.
  - `defer`: create a path-NULL project immediately (name + github facet + repoId). The Phase 2
    Projects manager already renders the "clone or pick folder" affordance for path-NULL rows.
- **Client**: a `projectImporterRegistry` contribution seam in client-core —
  `{id, label, glyph, component}` — rendered as buttons on the Projects manager
  ("Add folder…" is core; "Import from GitHub" is the plugin's entry). The wizard lists the
  mirror repos (`GET /v2/p/github/repos` refreshes it), lets the user multi-select and choose
  map/clone/defer, shows per-repo results.
- The mirror itself (`plugins/github.sqlite` `repos` table, ETag revalidation) is untouched —
  it just stops being the app's source of truth and becomes the wizard's candidate list.

## Bootstrap and first-run

After this phase a fresh install with no GitHub:

1. Boot → Default workspace exists (bootstrap's only remaining job), zero projects.
2. Onboarding modal → Projects manager → "Add folder…" or "Import from GitHub" (which starts the
   device flow via the existing integration settings if not connected).
3. Default rail surface = core's home source (task list for the active workspace), not the PR
   list. The PR source appears in the rail only when a github integration row exists.

Check `defaultSourceId()` (`packages/client-core/src/registries/sources.ts` ~:99) — it resolves
the `isDefault` contribution, so core's home source takes that flag over.

## Also in scope (cheap while you're here)

- `plugins/github/src/server/routes/pullConflicts.ts` runs local git against the mapped
  checkout — it resolves the checkout via `(owner,repo)`; switch to the task's project path.
- `adoptPullNumbers` (TaskService): PR-number adoption applies to **all** projects matching the
  (owner,name) facet, not just the oldest — that rule is documented in phase-1 and must survive
  this refactor.
- Avatars: `githubAvatarUrl` stays for PR authors (they ARE GitHub logins). Nothing to do unless
  a surface shows the machine identity.

## Verification

- `clientPluginDisable.test.ts` updated: github now disable-able; full client boots with it
  disabled (e2e tour — rail renders, projects manager works, no PR source).
- Import wizard test with a mocked mirror (map + clone + defer paths; clone against a local
  `file://` fixture repo keeps it hermetic).
- e2e: fresh data root, never connect GitHub → add folder → task → agent runs (Phase 0
  guarantees identity) → connect GitHub later → import a repo → PR source appears.
- `pnpm lint` + full suites, as always.
