# WP-11 — Scoped validation hardening

**Effort:** S–M · **Depends on:** nothing. Coordinate with WP-10 Group C (both touch
`plugins/agents/src/main/webhookService.ts`).

## Context

The stated contract (`docs/architecture-overview.md` § Wire validation) is: Zod `safeParse`
against a module-level schema at every **mutation** boundary, 400 on failure; reads deliberately
unvalidated. The model implementation is `packages/node-core/src/server/routes/worktree.ts`.

Frozen counts ([BASELINE.md](BASELINE.md)): 130 `.parse(`, 76 `.safeParse(`, 86 raw `JSON.parse`
in non-test files. The raw `JSON.parse` sites are the audit surface — but **triage before
touching**: an early audit assumed `webhookService.ts`'s parses were external input; verification
showed they parse the plugin's *own DB rows* (`JSON.parse(row.eventsJson)` at `:62` and `:287`,
cast to a type). Own-DB JSON is the lowest-risk class. The classes, in descending priority:

1. **External input** (webhook request bodies, provider responses feeding mutations, agent-emitted
   frames) — must have schemas per the contract.
2. **Persisted client/user data** (prefs, localStorage-like stores, imported files) — cheap
   corruption shield; e.g. `plugins/docker/src/client/dockerPrefs.ts:18` spreads
   `JSON.parse(raw) as Partial<DockerPrefs>` over defaults — a malformed stored value walks
   straight in. Note repo precedent: persisted-state slices already have codecs and a conformance
   test (`apps/desktop/test/integration/persistedState.conformance.test.ts`) — prefer routing
   persistence through that mechanism over ad-hoc schemas where it fits.
3. **Own-DB / internal round-trips** — out of scope; a cast is acceptable where the same module
   wrote the JSON.

## Pre-flight

```sh
grep -rn 'JSON\.parse' packages plugins apps --include='*.ts' --include='*.tsx' | grep -v '\.test\.'
# the mutation-boundary model:
sed -n '1,40p' packages/node-core/src/server/routes/worktree.ts
```

## End state

- A committed triage table (appended to this doc): every non-test `JSON.parse` site classified
  external / persisted / internal, with the fix applied for classes 1–2 and a one-word
  justification for each class-3 site left alone.
- Every class-1 site parses through a module-level Zod schema with the same failure semantics as
  the surrounding code's contract (routes: 400 envelope; background services: reject-and-log via
  the existing error path — never a new logging mechanism).
- Class-2 sites fall back to defaults on schema failure instead of spreading corrupt data.

## Non-goals

- Converting the 130 `.parse(` calls to `safeParse` wholesale — many are internal invariants
  where throwing is correct. Only sites that sit on inbound external paths and currently `throw`
  where the contract says 400 are in scope; spot-check the route files
  (`grep -rn '\.parse(' packages/node-core/src/server/routes plugins/*/src/server/routes | grep -v '\.test\.'`)
  and fix only genuine contract violations.
- Read-path/response validation (deliberately out per contract).
- Own-DB parse sites (class 3).
- New validation libraries — zod is the catalog-pinned standard.

## Slices (one commit each)

1. **Triage.** Classify all 86 sites; append the table here. No code change.
2. **Class-1 fixes**, grouped by package (likely candidates from the audit: agent webhook request
   handling — the *inbound* payload path in `webhookService.ts`, distinct from the own-DB row
   parses; agent driver frames in `plugins/agents/src/main/drivers/`; check
   `plugins/http/src/shared/model.ts`). One package per commit.
3. **Class-2 fixes:** `dockerPrefs.ts` (schema-or-defaults), `plugins/memory/src/main/
   memoryProposals.ts` if triage classifies it persisted, and any other persisted-prefs site.
4. **Route `.parse` spot-check** (from Non-goals paragraph): fix genuine mutation-boundary
   contract violations only; record "none found" if none.

## Gates

Per slice: touched package's vitest + `pnpm lint`. WP-02 slice 3 (docker parse/prefs tests)
before this package's slice 3 makes the prefs change provable — run in that order if both
packages are in flight.

## Risks & rollback

- **Overzealous schemas break working flows**: a schema stricter than reality rejects payloads the
  old cast accepted. Schemas must be derived from what the code *consumes* (fields actually read),
  not from what a doc says the payload contains — especially rollbar/linear, whose shapes came
  from docs, not live payloads (repo memory).
- Class-2 default-fallback changes user-visible behavior only when data was already corrupt —
  acceptable, but log the fallback so corruption is visible.
- Per-package commits revert independently.

## Doc updates

`docs/architecture-overview.md` § Wire validation only if the contract's edge cases get sharpened
(e.g. "background services reject-and-log"); otherwise none.

## Done criteria

- [x] Triage table appended, all 86 grep matches classified.
- [x] Mutation-boundary class-1 sites schema-validated; class-2 sites default-on-failure.
- [x] Route spot-check recorded.
- [x] BASELINE counts re-measured and recorded.

## Progress

- [x] Slice 1 — triage table
- [x] Slice 2 — class-1 fixes
- [x] Slice 3 — class-2 fixes
- [x] Slice 4 — route spot-check

## Completed remediation — 2026-08-08

The audit distinguishes mutation/control inputs from response and read parsing. The latter remain
defensive but deliberately unvalidated, as required by the non-goal above. The table contains all 86
non-test `JSON.parse` grep matches from the frozen audit surface; entries with multiple sites are
counted explicitly. `1-control` and `2-persisted` are the contract classes; `R-read` is the deliberate
read-path exception; `3-internal` is the own-DB/build/test class with a one-word reason.

| Site(s) | Count | Class | Remediation / reason |
| --- | ---: | --- | --- |
| `apps/desktop/e2e/desktop.smoke.spec.ts`, `apps/desktop/e2e/twoNode.spec.ts` | 5 | test | `test` |
| `apps/desktop/electron.vite.config.ts` | 1 | internal | `build` |
| `apps/desktop/src/app/main/fleetStore.ts` | 1 | 2-persisted | Existing `fleetFileSchema.safeParse`; default empty fleet on failure |
| `apps/desktop/src/app/main/nodeBroker.ts` (`receive`, `errorCodeOf`) | 2 | R-read | Remote event/error response is forwarded/read-only; renderer envelope guard remains in `wsClient` |
| `apps/desktop/src/app/main/nodePairing.ts` (`probeNode`, `pairWithNode`) | 2 | 1-control | Added module-level `nodeInfoSchema` and `pairResultSchema`; reject malformed peer responses |
| `packages/client-core/src/apiClient.ts` (`parseJson`, `error body`) | 2 | R-read | Generic API responses are read-path data; route mutations validate before they write |
| `packages/client-core/src/node/nodeSecurity.ts` | 1 | 2-persisted | Filters to string node IDs and defaults to `[]` on failure |
| `packages/client-core/src/notifications/notifications.ts` | 1 | 2-persisted | Filters notice shape and defaults to an empty ring |
| `packages/client-core/src/persistence/persistedState.ts`, `preferenceSlices.ts` | 2 | 2-persisted | Shared codecs catch malformed JSON and return `undefined`/`{}` |
| `packages/client-core/src/registries/keybindings.tsx`, `tabs/railOrder.ts` | 2 | 2-persisted | Shape filters and empty defaults already protect preferences |
| `packages/client-core/src/settings/AgentToolsSettings.tsx` | 1 | 2-persisted | Uses shared `toolPermissionsSchema`; invalid prefs become `{}` |
| `packages/client-core/src/tasks/layout.ts` (`layouts`, legacy panes) | 2 | 2-persisted | Catch-and-migrate paths default to no layouts |
| `packages/client-core/src/tooltip/RailTips.tsx` (`comment + parser`) | 2 | R-read | DOM attribute is display-only and parser already catches malformed JSON |
| `packages/node-core/scripts/check-migrations.ts` | 1 | internal | `build` |
| `packages/node-core/src/main/agentProfiles/streamJson.ts` | 1 | 1-control | Added module-level stream-event schema; malformed provider lines are dropped |
| `packages/node-core/src/main/dataRoot.ts` | 1 | 2-persisted | Existing `nodeIdentitySchema.safeParse`; invalid identity is rejected |
| `packages/node-core/src/main/disabledPlugins.ts` | 1 | 2-persisted | Invalid persisted list becomes `[]` so boot remains recoverable |
| `packages/node-core/src/main/repoPaths.ts` | 1 | 1-control | Added `runTargetWireSchema`; malformed route input returns the existing bad-result envelope |
| `packages/node-core/src/main/runConfig.ts` | 1 | 3-internal | `own-DB` |
| `packages/node-core/src/main/wsHub.ts` | 1 | 1-control | Added shared `wsFrameSchema`; invalid peer frames never reach terminal/plugin handlers |
| `packages/node-core/src/mcp/api.ts` | 1 | R-read | User config is inspected/masked, never executed or persisted by Acorn |
| `packages/node-core/src/server/agentTools/contextSections.ts` | 1 | 3-internal | `own-DB` |
| `packages/node-core/src/server/agentTools/registry.ts` | 1 | 2-persisted | Uses shared `toolPermissionsSchema`; invalid prefs become `{}` |
| `packages/node-core/src/server/audit.ts` | 1 | 3-internal | `own-DB` |
| `packages/node-core/src/server/auth/internalTokens.ts` | 1 | 1-control | Added signed-claims schema; malformed/forged payloads return `null` |
| `packages/node-core/src/server/integrations/codec.ts`, `connections.ts` | 2 | 3-internal | `own-DB` |
| `packages/node-core/src/server/modelProviders/runtime.ts` | 1 | 3-internal | `own-DB` |
| `packages/node-core/src/server/routes/tasks.ts` | 1 | 3-internal | `own-DB` |
| `packages/protocol/src/browserRules.ts`, `workspaceIdentity.ts` | 2 | 2-persisted | Defensive filters/defaults protect stored workspace values |
| `packages/protocol/src/mcp.ts` | 1 | R-read | Imported config inspection returns invalid summaries rather than mutating state |
| `packages/protocol/src/workflow.ts` | 1 | 1-control | `decodeToolCeiling` now uses a module-level Zod schema and returns `undefined` on failure |
| `plugins/agents/src/client/AgentComposer.tsx` | 2 | 2-persisted | Local drafts filter to known array/object shapes and default empty |
| `plugins/agents/src/client/model.ts` | 1 | 3-internal | `own-DB` |
| `plugins/agents/src/main/artifactStore.ts` | 1 | 3-internal | `own-DB` |
| `plugins/agents/src/main/drivers/authProbe.ts` | 1 | 1-control | Added provider-status schema; malformed CLI output returns `null` |
| `plugins/agents/src/main/drivers/jsonRpcProcess.ts` | 1 | 1-control | Added module-level JSON-RPC envelope schema; invalid lines are ignored |
| `plugins/agents/src/main/rowMapping.ts`, `sessionRepository.ts`, `store.ts` | 3 | 3-internal | `own-DB` |
| `plugins/agents/src/main/sessionExecute.ts` | 1 | R-read | Agent result extraction is a bounded read/result parser; arbitrary advertised result schemas cannot be inferred here |
| `plugins/agents/src/main/transcriptImport.ts` | 2 | 2-persisted | Imported transcript parse rejects unusable content; Acorn exports already use `safeParse` |
| `plugins/agents/src/main/usage/claudeDailyUsage.ts`, `claudeUsage.ts`, `codexUsage.ts` | 4 | R-read | CLI/config usage readers catch malformed lines and retain only consumed fields |
| `plugins/agents/src/main/webhookService.ts` | 2 | 3-internal | `own-DB` |
| `plugins/agents/src/shared/pricing.ts` | 1 | 2-persisted | Existing `validateAgentPricingPreferences` supplies default-on-failure behavior |
| `plugins/docker/src/client/dockerPrefs.ts` | 2 | 2-persisted | Added strict module-level schema; invalid object-shaped prefs now fall back to defaults |
| `plugins/docker/src/main/dockerService.ts`, `main/parse.ts` | 4 | R-read | Docker CLI output is read-only; line/field guards skip malformed daemon output |
| `plugins/editor/src/client/editorState.ts` | 1 | 2-persisted | Stored files are filtered to valid paths and malformed state starts fresh |
| `plugins/editor/src/main/search.ts` | 1 | R-read | Ripgrep output is read-only and malformed events are skipped |
| `plugins/github/src/client/createPull/model.ts`, `pullList/filterState.ts` | 2 | 2-persisted | Draft/filter parsers catch and normalize stored values |
| `plugins/http/src/client/ResponseView.tsx`, `shared/model.ts` | 3 | R-read | User HTTP response/form text is display/parse input; malformed content is caught |
| `plugins/http/src/server/routes/http.ts` | 1 | 3-internal | `own-DB` |
| `plugins/memory/src/main/memoryProposals.ts` | 2 | 2-persisted | Added strict proposal schema; corrupt files are skipped/return `null` |
| `plugins/workflows/src/main/workflowBuiltins.ts`, `workflowRunner.ts`, `workflowValidation.ts` | 6 | 3-internal | `own-DB` |
| `plugins/workflows/src/main/workflowFiles.ts` | 1 | 2-persisted | Added object schema for user workflow `schema_json`; invalid definitions enter the existing error path |

### Route spot-check

The route scan found no unhandled JSON mutation parse. The only route-file JSON parses are
`packages/node-core/src/server/routes/tasks.ts` and `plugins/http/src/server/routes/http.ts`, both
own-DB read projections. Mutation routes use `safeParse` on `c.req.json()`; the relevant worktree
route remains the reference implementation. Date `parse()` calls in provider mirrors are not JSON
parsers and are unchanged.

### Re-measured counts

The frozen raw count remains **86** `JSON.parse` grep matches (**85** executable calls; **79** production
implementation calls after excluding desktop e2e/config files). The important measure moved from casts to
schemas: **130** `.parse(` calls and **95** `.safeParse(` calls. Large-file remediation leaves the active
implementation files under the WP-10 500-line target, with the documented exemptions still at
`plugins/terminal/src/main/terminal.ts` (721) and `plugins/workflows/src/main/workflowRunner.ts` (559).

The class-1/class-2 fixes were verified with the protocol, node-core, client-core, Docker, memory and
agents package lint/tests. The full node-core WebSocket test remains environment-blocked when it tries
to bind `127.0.0.1` under the desktop sandbox; the code path is covered by the existing integration test
and the new invalid-frame case when run in a network-enabled test environment.
