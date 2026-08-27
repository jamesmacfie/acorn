# Phase 1: the security burn-down

Part of [phased-review-steps](./README.md). This phase closes every confirmed finding in
[the security review](../../reviews/2026-08-27-security-review.md) and folds in the loopback API
gates from [sandbox/api-gates.md](../sandbox/api-gates.md), because the two documents found the
same class of hole from two directions: a route reachable by a task-scoped token that should not
be. The sandbox folder's phases 1 and 2 land here in full; its later phases (per-task OS
isolation, managed policy) stay owned by that folder.

The cloud framing makes this phase a prerequisite rather than hygiene. Every one of these holes is
reachable by an agent's own token, and a cloud node runs agents with nobody watching the screen.

Group 1a is renderer hardening, 1b is loopback API confinement, 1c is the trust snapshot, 1d is
defaults and shapes that prevent the next hole rather than fixing a live one.

## 1a. Renderer and input hardening

### 1a.1 Set a Content-Security-Policy on the main webview

Security review, finding 1. `apps/desktop/src-tauri/tauri.conf.json:22` sets `"csp": null` on the
one webview that holds a capability (`invoke` works) and renders text acorn does not author: agent
transcripts, GitHub `bodyHTML`, Linear descriptions, Rollbar payloads. Plugin frames get a
nine-directive policy enforced by a Rust test; the privileged webview gets nothing.

Start from `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'` and make
every exception earn itself. Expect at least a `style-src` allowance for the appearance bridge's
inline custom properties; test against all four style packs, both color axes, the terminal, and
Monaco before landing. Record the final policy and each exception's reason in `docs/security.md`,
and pin it with a test the way `plugin_scheme.rs:134` pins the frame policy.

While here, list the four `innerHTML` sinks that pass GitHub's `bodyHTML` through verbatim
(`plugins/github/src/client/PullDetail.tsx:232`, `pullDetail/Conversation.tsx:66` and `:138`,
`packages/client-core/src/ui/diff/DiffRows.tsx:419`) in `docs/security.md` as the sinks the CSP
now backstops. No code change to them; the finding is the missing second layer, not a live bug.

### 1a.2 Fix the markdown sentinel crash

Security review, finding 2, confirmed crash on untrusted input.
`packages/client-core/src/ui/markdown.ts:32` reserves U+E000 as a sentinel; the restore passes
index into `codes` and `images` with a number the input chose. Strip U+E000 from the input on the
way in, which kills the class rather than one instance, and add the review's three probe strings
as regression tests. Consider an `ErrorBoundary` in `Markdown.tsx`'s owner chain separately; the
strip makes the known crash unreachable, the boundary catches the next one.

## 1b. Loopback API confinement

The root cause across this group, named by [sandbox/api-gates.md](../sandbox/api-gates.md): a core
route that should be device-only was mounted at `requireUser` because nobody wrote the line. The
durable fix is item 1b.5; the rest close the known instances.

### 1b.1 Gate prefs behind requireDevice

Sandbox gate 1, severity highest. The `agentTools.perms` tool ceiling lives in a prefs slice, and
`PUT /v2/core/prefs` (`packages/node-core/src/server/index.ts:85`, handler
`server/routes/prefs.ts`) is `requireUser` only, so a task-scoped agent token can rewrite its own
tool ceiling. Add the two `requireDevice` lines matching the seven gated mounts above it. Safe
because prefs are written only by the settings UI on a device principal; the in-process
`PrefService.write` path is unaffected.

### 1b.2 Gate projects behind requireDevice

Sandbox gate 2, severity high. The project row holds `setupScript`, `devScript`,
`devRestartScript`, `teardownScript`, and `dbUrlScript`, which acorn executes later, and the mount
at `server/index.ts:92` is `requireUser` only, so a task token can rewrite any project's scripts.
Same two-line fix. If a future agent tool needs to read its own project's configuration, add a
task-addressed read route under `/v2/core/tasks/:id/...` rather than widening this gate.

### 1b.3 Gate workspaces behind requireDevice

Sandbox gate 3, severity moderate. Mount at `server/index.ts:93`; create, patch, and delete are
not task-addressed, so a task token can delete workspaces. Same fix.

### 1b.4 Filter task-statuses by mayActOnTask

Security review, finding 3. `GET /v2/core/task-statuses`
(`packages/node-core/src/server/routes/worktree.ts:127`) returns every active task's id, absolute
worktree path, and dirty count to any task-scoped credential. Filter to `mayActOnTask` when the
principal is task-confined, the same answer `docs/security.md` records for terminal's session
roster. The route is also grantable to plugin frames under `core.tasks:read`
(`frames/scopes.ts`), so the filter closes two callers.

### 1b.5 The mount-coverage test

Sandbox api-gates, "A test to keep the gaps closed". Add an arch test asserting every mount under
`CORE_NAMESPACE` is device-gated, provider-gated, task-scoped, or on a named allowlist of routes
deliberately reachable by a task token, each with its reason inline. Model it on the
`child_process` allowlist in `tools/arch/boundaries.test.ts:217`. This is the one piece of new
machinery in the group, and it converts the root cause from drift into a decision.

### 1b.6 Gate the GitHub device-flow routes

Security review, finding 6. `/auth/device/start` and `/auth/device/poll` in
`plugins/github/src/server/routes/deviceAuth.ts` are registered with `prefix: ''` and reachable by
a task-scoped token, allowing a confused-deputy connection of an attacker-controlled GitHub
account. Put `requireProviderAccess`, or the plugin-local equivalent the HTTP panel uses, in front
of both routes. The false comment is deleted in phase 0.

### 1b.7 Notes workspace routes: landed, verify

Security review, finding 8 reported the workspace half of notes ungated. The tree carries the fix:
`plugins/notes/src/server/routes/notes.ts:21` mounts `requireDevice` over
`/workspaces/:wsId/notes/*`. Two checks before closing the finding: confirm the middleware pattern
also covers the bare `/workspaces/:wsId/notes` list and create paths (no trailing segment) under
the repo's Hono version, and add a test that a task-confined principal receives 403 on both the
list and a write, so the gate cannot rot the way the device-flow comment did.

## 1c. Trust the project row

Sandbox phase 2, the belt behind gate 1b.2. Extend `readRepoConfigSnapshot`
(`packages/node-core/src/main/repoConfigTrust.ts:30`) to include the project row's executable
fields (`setupScript`, `devScript`, `devRestartScript`, `teardownScript`, `dbUrlScript`) in the
hashed snapshot, so changing a script produces a `needs-trust` review before it runs. Update
`docs/security.md` to say the untrusted input is repo config and the project row. The gate makes
the write path device-only; the snapshot makes a compromised write visible anyway.

## 1d. Defaults and shapes

None of these fixes a live bug. Each removes a way for one to arrive quietly, which is the
security review's closing argument for them.

- **Flip the execute tier to default-deny.** Security review, finding 5. `isToolPermitted`
  (`packages/node-core/src/server/agentTools/registry.ts`) falls back to `true` for every tier, so
  a tool added in a later release is granted to every existing installation with no prompt. Change
  the `execute` fallback to `false` and surface the eight affected terminal run-target tools as a
  settings row the owner turns on. Decide `write` explicitly while there; the review argues only
  `execute` must flip.
- **Verify npm integrity in the installer.** Security review, finding 4.
  `packages/node-core/src/main/pluginInstaller.ts:135` records `dist.integrity` into provenance
  and never compares it against the downloaded bytes. Compare in `download` and fail the install
  on mismatch. A few lines, and it turns provenance from a note into a check.
- **Make the terminal repo-config gate structural.** Security review, finding 9. The guard that
  stops a cloned repository executing its committed config disappears silently if
  `RuntimeDeps.repoTargetIds` or `authorizeRepoConfig` is absent
  (`plugins/terminal/src/main/runtime.ts:85`, `:113`; both optional at `:25`). Make both required
  and let the type system carry the gate.
- **Make requireTaskScope deny on a missing id.** Security review, finding 7.
  `requireUser.ts:71` allows the request when `c.req.param('id')` is absent. Hono populates it
  under every current mount, so there is no live bug, but the shape fails open. Respond 404 on a
  missing id.
- **Fix the docker config comment.** Security review, finding 10.
  `plugins/docker/src/main/dockerConfig.ts:1` justifies the ungated `[docker]` override with a
  reason that is not what keeps it safe. Rewrite the comment to state the real invariant: exec is
  ref-addressed from the WS frame, never matcher-addressed, and the hub refuses docker channels to
  task-confined sockets. If either invariant ever changes, the override needs the trust gate.
- **Resolve the `[scripts]` drift.** Security review, finding 7. `runConfig.ts:240` merges
  `repo?.setup` and nothing reads the result; `maybeRunSetup` reads the project row instead. Either
  wire the merged value or delete the parse, so a repo cannot declare a setup script that silently
  does nothing.
- **`resolveInRoot` check-then-use**: recorded, not scheduled. The honest fix is an
  `O_NOFOLLOW`-style open, which is real work for a hard-to-hit window. Note it in
  `docs/security.md` as a known limit; the per-task sandbox
  ([sandbox/sandbox.md](../sandbox/sandbox.md)) is the layer that eventually subsumes it.

## Acceptance

- A task-scoped internal token receives 403 (or a filtered result, for `task-statuses`) on:
  `PUT /v2/core/prefs`, every `projects` write, workspace create and delete, both GitHub
  device-flow routes, and notes workspace reads and writes. The renderer, on a device principal,
  is unaffected.
- The mount-coverage test exists and fails when a `requireUser`-only core mount is added.
- The main webview has a non-null CSP pinned by a test, and the app renders correctly under it
  across style packs, the terminal, and Monaco.
- `renderMarkdown` returns escaped output, not a throw, for all three probe inputs from the
  review.
- Changing a project script from the settings UI produces a `needs-trust` review before the
  script runs.
- An execute-tier tool with no recorded preference is denied and visible in settings.
- `docs/security.md` reflects every change: the CSP and its exceptions, the project-row trust
  input, the execute default, and the updated "what held" claims.

## Verify before building

- Re-read the mount table in `packages/node-core/src/server/index.ts`; the line numbers here
  (85, 92, 93) predate phase 0's commit and any route added since.
- Confirm finding 8's gate is still present at `notes.ts:21` and check whether anyone already
  added the mount-coverage test; the api-gates file predicts someone might partially apply it.
- Check `docs/security.md § The containment ladder` for whether rung 2 shipped; it changes the
  wording this phase writes but not its content.
- The security review's "What held" section lists the attacks that failed. Do not spend this
  phase re-attempting them; do re-run its two confirmed probes (markdown sentinel, device-flow
  reachability) to confirm they still reproduce before fixing.
