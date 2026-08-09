# Phase 4 — The SmolForge plugin

**Size: L.** Requires phases 0–3. Build as a **first-party compiled-in plugin**
(`plugins/smolforge/`, both composition lists — the Linear/Rollbar path), then use it as the
dogfood candidate for the loaded-plugin path (docs/plugins.md § Loaded plugins). This doc describes the
first-party build; the final section lists what changes when repackaged.

API reference throughout: `forge/llms.txt` (§ Authentication, § Personal Access Tokens,
§ Issues, § Pull Requests, § CI/CD Actions, § AI Transcripts, § Webhooks). Base URL is
configurable (`https://forge.smol.ai` default; self-hosted deployments exist —
`SMOLFORGE_BASE_URL` is the CLI's precedent).

## Package shape

```text
plugins/smolforge/
  src/
    node/       plugin entry: provider registration, capabilities wiring, sync, own DB
    server/     /v2/p/smolforge routes (issues, pulls, transcripts, checks)
    client/     sources, panes (issue/PR/transcript views), settings, origin registrations
    contract/   (none expected initially)
    shared/     wire types for its own routes; forge API response types
```

## Authentication

- Register a `ConnectionProviderContribution` with connection settings: base URL + a credential
  slot for a **PAT** (scopes `repo:read`, `repo:write`, `transcripts:write` — llms.txt
  § Personal Access Tokens; the connect UI should name these exact scopes and link the forge's
  PAT page).
- **All forge traffic goes through the credential-injecting fetch broker**
  (docs/security.md), even while first-party: the plugin passes
  `(credentialSlot, request)` and never reads the token. If the broker doesn't exist yet when
  this phase starts, build it then — this plugin is its first customer and the design is
  already written; do not ship an interim "read the secret and fetch" path that has to be
  un-taught later.
- Redirect policy and host allowlist come from the connection's base URL (self-hosted =
  different host). No other egress.
- Connection health check: `GET /api/accounts` (or the cheapest authenticated read) surfaced as
  the standard integration status.

## Repo association

Register the phase-0 `remoteClaim`: parse HTTPS and SSH remote forms for the configured host
set into `ref: "owner/repo"`. Everything project-scoped below gates on the claim (phase-0
predicate) AND a connected integration.

## Issues and PRs: the Linear/Rollbar shape

- Mirror via the **generic external-item store** (`server/integrations/itemStore.ts` /
  `resourceRuntime.ts`) with codecs for two item kinds: issues and pulls. Provider data is
  disposable; drop-and-refetch must always be safe.
- Freshness: serve-then-revalidate on read (sync engine, `server/sync/engine.ts`, TTL in
  `policy.ts` conventions) plus a `ctx.schedule.every` background revalidation (phase 2) for
  claimed projects — the Node cannot receive forge webhooks (loopback), so polling is the
  design, not a stopgap. Respect the forge's pagination (`?page=&limit=`).
- Endpoints: `GET /api/repos/:owner/:repo/issues`, `/pulls`, detail + comments per llms.txt.
  Comments/labels render read-only in v1; posting a comment is one `runNodeAction` route when
  wanted.
- Rail sources: "Forge issues" and "Forge PRs" per claimed project, rows promoting via the
  phase-1 origins `smolforge:issue` / `smolforge:pr` (client `taskOrigins` registrations with
  Lucide icon names). Promotion drives worktree-first task creation on the project the claim
  resolved.
- PR detail pane: compare/commits/changed-files/merge-status from § Pull Requests; the
  fast-forward merge action is permission-gated forge-side — surface its errors verbatim
  (stale-head/base protection responses are meaningful).
- CI: run/job status per PR (§ CI/CD Actions) rendered as check rows on the PR pane; a footer
  badge (descriptor `slots` when on the descriptor tier; a small component while first-party)
  showing the focused task's branch run status; attention items for "PR mergeable" / "run
  failed".

## Transcript upload: the novel flow

The plugin's own SQLite (this is why it owns a DB file, unlike Linear/Rollbar) stores upload
state: `uploads(session_id PRIMARY KEY, task_id, project_id, forge_ref, transcript_id,
uploaded_at, commit_sha)` plus a per-task high-water mark.

Flow:

1. Subscribe `AGENTS_ON_SESSION_STATUS` (phase 2); on `done`, if the session's task belongs to a
   claimed+connected project and the owner enabled upload for that project (below), proceed.
2. `AGENTS_TRANSCRIPT_EXPORT.read(sessionId)` (phase 3) → versioned acorn JSONL + meta.
3. `POST /api/repos/:owner/:repo/transcripts` via the broker with `content` and
   `commit_sha: meta.headShaAtEnd ?? undefined` (llms.txt § AI Transcripts). Record the returned
   transcript id.
4. Reconcile on `ready()`: `listCompleted({ afterSessionId: highWaterMark })` per the phase-2
   reconcile pattern — sessions finished while the Node was down get uploaded late, not never.
5. Late commit linkage (optional v1.1): correlate `CORE_ON_COMMIT_CREATED` observations with
   recent uploads lacking `commit_sha` and re-upload/patch if the forge API allows.

**Consent is per-project and default-off.** Uploading agent conversations to a remote service is
the most sensitive thing this plugin does: a project-level toggle ("Upload agent transcripts to
alice/demo on forge.smol.ai"), off until the owner enables it, stated in the integration's
settings surface. Secret-masking happens forge-side before display (README § AI transcripts) but
the upload transmits transcript contents — the toggle copy must say that plainly. This mirrors
the phase-3 permission wording ("can read agent conversation contents") and, when third-party,
rides the `agents.transcriptExport` permission.

Transcript browsing: a "Transcripts" section on the project/PR panes reading
`GET /api/repos/:owner/:repo/transcripts` (+ by-commit lookups on commit surfaces) — read-only
list + detail rendering of the forge's masked display form.

## Client registration summary

Sources (issues, PRs), panes (issue detail, PR detail, transcripts), settings page (connection +
per-project upload toggles), palette rows ("Create forge issue task…"), attention items
(PR/checks), task-origin registrations, and the phase-0 claim predicate gating all of it. Every
piece uses existing contribution points — this phase adds no new registries.

## Tests

- Codec round-trips for issue/pull payloads (fixture JSON from llms.txt examples).
- Claim parsing: HTTPS/SSH/self-hosted host forms, `.git` suffix, negative cases.
- Upload state machine: done→upload→recorded; reconcile pages from high-water mark; per-project
  toggle off → nothing leaves; broker rejection (401 from forge) surfaces as integration
  attention, retries on next reconcile rather than tight-looping.
- Route handlers with the bridge/test-capability pattern
  (`server/bridge.ts` setter functions exist for isolated route tests).
- e2e (desktop): against a local `wrangler dev` forge (forge/README.md § Running Locally) —
  connect with a PAT, see issues, promote one to a task, complete a fake agent session, verify
  the transcript lands. This doubles as the integration smoke for phases 0–3.

## When repackaged as a loaded plugin (later)

- Manifest: `permissions.api` for its core reads, `events`, `node.capabilities:
  ["agents.onSessionStatus", "agents.transcriptExport", core lifecycle ids]`, `secrets: true`,
  `net: [<base URL host>]`; contributions move to the manifest (sources/slots/palette as
  descriptors; issue/PR/transcript panes as `frame` surfaces, `formFactor: ["desktop"]`).
- The panes rebuild against the bridge SDK instead of client-core internals — the read paths are
  already route-shaped, so the delta is UI plumbing, not architecture.
- The per-project upload consent stays an in-plugin setting; the trust prompt adds the
  capability-level disclosure on top.

## Exit criteria

- Against a live or local forge: connect, claimed projects show issue/PR sources, promote an
  issue to a task (worktree-first), PR pane shows compare/checks/merge, a completed agent
  session's transcript appears on the forge linked to the right commit, and disabling the plugin
  degrades every surface cleanly (tasks keep rendering via the origin fallback).
- No secret ever readable by plugin code (broker-only, asserted in tests).
- `pnpm lint`, suites, boundaries test, desktop e2e green.
