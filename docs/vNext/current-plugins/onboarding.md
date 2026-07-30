# Onboarding plugin migration

Status: **Normative**<br>
Coordinate: `acorn/onboarding`<br>
Requirement prefix: `CUR-ON`

## 1. Current behavior and authoritative state

V1 opens a first-run modal once authenticated preferences/workspaces load, at least one workspace
exists and preference `onboarded` is not `1`. The modal embeds the same
`WorkspaceRepoAssignments` used by Settings. Saving that single preference closes it; later changes
occur in Settings. Repository discovery/bootstrap has already assigned repositories to Default
before the modal appears. Core `App.tsx` imports the plugin component directly.

- **CUR-ON-001:** V2 core owns the invariant and versioned completion record that determine whether
  first-run setup is fulfilled. Onboarding owns the declarative guidance/flow, not shell startup.
- **CUR-ON-002:** Completion commits only after required Node, encryption and workspace invariants
  succeed. Closing, disconnecting or crashing never marks completion.

## 2. Current UI, routes, events, contributions, and dependencies

V1 contributes one modal titled “Set up your workspaces,” repository/workspace mapping controls and
a Done button. It has no route, public API, Node runtime, durable event or plugin storage. It uses
core preferences and workspace mutations directly. The UI depends on authentication, preference
and workspace query order.

V2 replaces the single modal with a system-start setup wizard while preserving the immediate,
non-technical local-first path. Fleet pairing and plugin setup are additive steps only when
relevant.

## 3. Target V2 classification and trust/runtime tier

- **CUR-ON-003:** Onboarding is a bundled **Acorn Verified** declarative-only plugin in the default
  installation profile.
- **CUR-ON-004:** The Electron client MUST ship a minimal built-in recovery screen independent of
  this plugin, sufficient to repair/reinstall it, reconnect a Node or resume its wizard.

## 4. Node, Electron, native-host, and renderer split

Node core evaluates/persists setup invariants, wizard session state, imported workspace config and
command outcomes. Electron hosts the system-start wizard, local presentation state and native
directory chooser through a narrow core capability. Onboarding supplies semantic steps, copy,
ordering and declared actions. Standard wizard/form/list/status renderers provide visuals.

- **CUR-ON-005:** Onboarding has no executable Node/native artifact and cannot read paths,
  repositories, secrets or plugin state directly. Declared actions invoke scoped core commands.
- **CUR-ON-006:** A remote Node presents server-owned workspace choices and safe path labels; it
  cannot trigger an Electron-local file chooser unless a separate client-local action is declared.

## 5. Manifest, required capabilities, permissions, dependencies, and optional integrations

The manifest contributes a `system-start` wizard, Settings resume/review entry, setup-incomplete
attention item and completion navigation intent. It requires queries for Node security posture,
workspace/repository configuration, configuration-import preview, default-profile status and
onboarding completion; commands create/update workspace assignments, import approved
configuration, install/resume default profile and commit completion.

Onboarding depends only on versioned core capabilities. Individual plugin setup wizards are invoked
through the host wizard registry; Onboarding never imports them or inherits their permissions.

- **CUR-ON-007:** Each nested setup step retains its own owning plugin, permission prompts and
  resumable state. Onboarding receives status/result, not credentials or private wizard fields.

## 6. Queries, commands, exported capabilities, events, and streams

| Contract | Kind | Result |
| --- | --- | --- |
| `dev.acorn.onboarding.status.get.v1` | query | Fulfilled/missing invariant IDs and current step |
| `dev.acorn.onboarding.import.preview.v1` | query | Safe workspace/repository config diff |
| `dev.acorn.onboarding.workspace.configure.v1` | command | Create/update selected assignments |
| `dev.acorn.onboarding.import.apply.v1` | command | Import only approved V1 config classes |
| `dev.acorn.onboarding.default-profile.ensure.v1` | resumable saga | Coordinated required package installs |
| `dev.acorn.onboarding.complete.v1` | command | Commit versioned invariant evidence |
| `dev.acorn.onboarding.reset-presentation.v1` | client command | Reopen guidance; no data reset |

- **CUR-ON-008:** Completion emits core `dev.acorn.onboarding.completed.v1` with Node URI,
  contract version and fulfilled invariant IDs. `step.changed`, `resumed` and `blocked` may be
  retained lifecycle events but contain no path, repository URL credential or nested-wizard data.
- **CUR-ON-009:** Commands are idempotent and revisioned. The default-profile operation is a saga:
  partial installs remain visible/resumable and completion cannot hide them.

No stream is required.

## 7. UI contributions and renderer requirements

The wizard contains: local Node explanation; node fingerprint/pairing only for a chosen remote
Node; OS full-disk-encryption status; create or preview/import workspace/repository configuration;
repository checkout accessibility; default plugin profile with blocked setup; final validation and
completion. Local fresh install uses direct language and defaults so fleet concepts do not obstruct
the V1-equivalent path.

- **CUR-ON-010:** Each step declares title, explanation, accessibility heading, validation,
  async-progress, retry, cancel/resume behavior and next/back policy. Focus returns to the first
  invalid field; progress is announced.
- **CUR-ON-011:** Cancel is allowed only when the shell can show an actionable setup-incomplete
  state. It never leaves a blank or apparently functional workspace.
- **CUR-ON-012:** Mobile fallback supports status, remote pairing and workspace selection but labels
  desktop-only local path picking explicitly.

## 8. Storage, migrations, backup, uninstall, and reinstall behavior

Core stores the wizard session, completion contract version, fulfilled invariant evidence and
workspace/import results. Electron stores only current visual expansion/focus. Onboarding owns no
plugin database. Completion participates in encrypted Node backup as core state; local visual state
does not.

- **CUR-ON-013:** V2 clean start does not import V1 `onboarded`. Only repository/workspace
  configuration may be previewed and imported into the separate V2 root; Tasks, sessions, notes,
  plugin data, tokens, preferences and API credentials remain untouched.
- **CUR-ON-014:** Disabling/uninstalling guidance cannot erase completed workspace data. Reinstall
  recomputes invariants; it does not force setup merely because plugin state was absent.

## 9. Setup, settings, health, update, and failure behavior

Onboarding itself has no setup or settings beyond reopen/resume. Health is derived from renderer,
core setup-capability and default-profile availability. Failures distinguish invalid/inaccessible
path, unavailable repository, import conflict/partial saga, missing plugin artifact, permission
denial, Node disconnect and unsupported client capability.

- **CUR-ON-015:** A new onboarding contract may require a delta flow only for a new mandatory
  invariant. Copy changes or optional features MUST NOT silently invalidate existing completion.
- **CUR-ON-016:** On reconnect/restart, the Node returns the persisted wizard state and rechecks
  side effects before offering retry.

## 10. Security and credential treatment

- **CUR-ON-017:** Import is a read-only preview followed by explicit apply. It accepts only
  repository/workspace configuration, validates paths/URLs, rejects executable config and never
  reads V1 secrets/databases beyond the documented importer boundary.
- **CUR-ON-018:** Secret/OAuth fields belong to nested plugin wizards and are write-only. Onboarding
  cannot observe, log, cache or event them.
- **CUR-ON-019:** Node fingerprints and full-authority pairing receive high-friction confirmation;
  onboarding copy MUST NOT imply remote Nodes are automatically trustworthy.
- **CUR-ON-020:** Native path selection returns a scoped opaque selection to the Node command; the
  declarative document cannot request arbitrary filesystem reads.

## 11. Existing coupling that must be removed

Remove `core/client/App.tsx` import of `OnboardingModal`, direct preference-key coupling and direct
workspace component reuse. Replace with core invariant query/completion command, system-start
wizard contribution and standard workspace-selection renderer. Core retains only the recovery UI
and policy trigger, never plugin copy/layout.

## 12. Exact fresh-install visual and behavioral parity scenarios

- **CUR-ON-021:** Bundled local fresh install reaches workspace assignment immediately, preserves
  existing repository grouping/mapping behavior and opens the normal shell after Done/completion.
- **CUR-ON-022:** Completion prevents repeat display; Settings can edit assignments without
  restarting onboarding, and “Review setup” can reopen guidance without clearing data.
- **CUR-ON-023:** Crash/cancel/failed import resumes the exact safe step, reports partial default
  plugin installs and never writes a false completion.
- **CUR-ON-024:** Remote first use verifies the selected Node fingerprint before full-authority
  pairing, then uses the same Node-owned setup contracts without exposing server paths as local.
