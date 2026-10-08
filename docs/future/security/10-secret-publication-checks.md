# Phase 10: check secrets before publication

Date: October 8, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `079f5c948161ea8213bcdb25fe2fbefccab7d6f1`.
Dependency: none of phases 01 to 09; phase 06 may reuse the detector for review redaction.

This phase checks credential-shaped content before Acorn commits, pushes, exports a transcript, or
sends supported attachment content to a provider. Give it to the developers owning Changes and agents.

## Problem and outcome

An agent can copy a credential into source, a test fixture, a transcript, or an artifact. Logging
redaction does not remove that value from Git or an exported file. The owner needs a check at the
operation that publishes the content, with evidence tied to the bytes that operation consumes.

The outcome is a local detector and optional publication gate with precise, redacted findings.
It covers Acorn-owned publication paths and states the paths it cannot intercept.

## Starting points and owners

Read these owners and their tests:

- `plugins/changes/src/server/localGit.ts` owns commit and push admission and their optional hooks.
- `plugins/changes/src/server/localDiff.ts` owns Git reads and the actual commit and push operations.
- `plugins/agents/src/server/sessions/runtime.ts` owns outgoing turns and session export.
- `plugins/agents/src/server/sessions/attachmentStore.ts` owns attachment bytes and scope.
- `plugins/agents/src/server/sessions/artifactStore.ts` owns immutable generated artifacts.
- `plugins/agents/src/server/routes/managedBridge.ts` exposes upload and session export operations.
- `plugins/agents/src/client/sessions/exportHistory.test.tsx` covers the client export flow.
- `packages/node-core/src/server/audit.ts` and `packages/node-core/src/server/core/secrets.ts` own
  audit privacy and credential handling.

Read [the Changes pane](../../diff-rendering/changes-pane.md), [credentials](../../security/credentials.md),
[audit](../../security/audit.md), and [the transcript](../../managed-agents/transcript.md).

## Detection and policy

Run detection locally without provider calls, token validation, source uploads, or automatic model
review. Prefer a maintained detector such as Gitleaks if its payload, licence, and platform distribution
fit Acorn. Verify those costs before adding it. A small adapter owns findings and policy; do not copy
large vendor rule sets into product code or invent token-format rules without fixtures.

Distinguish high-confidence provider token and private-key formats from generic entropy or assignment
heuristics. All findings name the detector version, rule, file or artifact identity, and line or byte
location. Reports contain a fixed redaction marker, never matching token substrings or full lines.
Audit and telemetry contain counts, rule IDs, scope, digest, and decision only.

Include test fixtures and generated text. Exclude placeholders by narrow content rules, not by whole
directories. Do not label a matching shape as a confirmed live credential. Signing a JWT or finding
high entropy is not by itself proof that a string is a secret.

Offer **Check for secrets** without enabling blocking. Add a per-Node, device-editable
**Block publication with secret findings** setting, off by default. When enabled, high-confidence
findings block, heuristic findings warn, and incomplete required scans block with a retry action.
The owner can allow one exact operation after review. Bind that allowance to its content digest,
destination and operation identity, detector version, and a short expiry. A changed operation requires
another review. Task, service, and plugin-frame callers cannot change policy or authorize an exception.

## Git admission

Scan staged blobs for commit, including untracked files after staging. Bind admission to the exact
index tree and commit options. For an amend, include the final tree the commit will contain. Recheck
the tree before commit, coordinate Acorn-owned stage/commit operations, and reject drift. Document
the residual race from an external Git writer; do not claim a filesystem transaction that Git does not provide.

Inventory native Git hooks too. A hook can change the index after an ordinary pre-command scan.
Verify the selected admission mechanism binds the final tree despite those hooks, while preserving
the owner's hooks. If that cannot be established, return incomplete coverage and require an explicit
operation allowance when blocking is enabled. Do not disable hooks silently or claim final-tree coverage.

For push, resolve the actual remote destination, source refs, expected remote refs, and outgoing commit
range. Scan newly reachable blobs across that range, including secrets deleted by a later commit.
A clean final worktree does not establish clean outgoing history. Bound objects and bytes and reuse
blob results by object ID and detector version. Handle initial pushes, new branches, tags, and force
updates deliberately. If the range cannot be established, an enabled gate returns incomplete.

Admission belongs immediately before Changes executes the operation, not solely in an optional hook
that continues after error or timeout. Preserve the commit-message transform and push veto contracts.
Keep force-with-lease and scope checks. A one-operation allowance cannot bypass other policy vetoes.

## Transcript, attachment, and artifact admission

Inventory the actual Acorn export and provider-send paths before implementing gates. Export scans the
exact serialized transcript bytes. Do not scan only the visible transcript or a sampled event page.
Offer a redacted export as a separate artifact; preserve the original session and identify the chosen
export variant. Recheck the serialized digest before download or save.

Attachment storage is an inbound operation and is not publication by itself. Gate the provider send
that consumes an attachment, using its immutable artifact identity and byte digest. Scan supported
text formats with explicit decoding and byte bounds. Report images, archives, PDFs, and other unsupported
formats as unscanned. When blocking is enabled, sending unscanned attachments needs an explicit
operation allowance. Do not add OCR, arbitrary archive execution, or a general upload gateway.

Each additional Acorn-owned external upload or share action needs its own named admission point.
List covered operations in the UI and docs. Direct shell Git, curl, other MCP servers, browser form
uploads, raw filesystem copies, and external apps stay outside coverage. Provider-generated artifacts
are checked when an Acorn-owned action publishes them, not by silently altering the provider's output.

## Ownership and implementation sequence

1. Inventory commit, push, export, and provider-send byte sources and their mutation windows.
2. Select and pin a detector; build pure result normalization and synthetic credential fixtures.
3. Introduce the narrow shared detector contract needed by Changes and agents, with bounded execution.
4. Add manual reports, device-only policy and one-operation decisions, then direct operation admission.
5. Integrate redacted export and attachment decisions without changing stored originals.
6. Update the owning docs with supported formats, covered operations, and bypass limits.

Put the shared detector in a demonstrated common Node owner with a public typed entrypoint. Keep Git
selection in Changes and session serialization in agents. Do not import one plugin's implementation
from another. Mutable approval state has one Node owner and bounded retention. Do not retain matching
secret values in a cache; cache object identities and normalized redacted results only.

## Acceptance and verification

Prove these behaviours:

- Synthetic provider tokens and private keys are detected in source and fixtures without value leakage.
- Narrow placeholders pass, and entropy-only findings warn instead of automatically blocking.
- Commit checks the index, not different disk bytes. A changed staged tree invalidates admission.
- A native Git hook that changes the index cannot produce a falsely clean checked commit.
- Push detects a secret introduced and removed in outgoing history, and handles branch/tag destinations.
- A missing remote baseline, exhausted quota, timeout, or detector failure blocks an enabled gate.
- One-operation allowances reject changed content, destinations, detector versions, and expired decisions.
- Task and service callers cannot approve exceptions. Other commit and push vetoes still apply.
- Transcript export scans serialized bytes; redacted export preserves the stored original.
- Outgoing text attachments are checked, and unsupported formats disclose incomplete coverage.
- API bodies, logs, audit rows, errors, and cached results contain no matched credential value.

Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-changes --filter=@acorn/plugin-agents --filter=@acorn/node-core`,
changed shared packages and consumers, and `pnpm --filter @acorn/arch-tests test`. Use a local fixture
Git remote for push tests; never publish credential fixtures to a real repository. In the real desktop
app, check a staged synthetic token, blocked operation, exact-operation allowance, and redacted export.
Stop the driver session afterward. Update `docs/security.md`, `docs/diff-rendering/changes-pane.md`, and the managed-agent docs.

## Research and limits

`references/noclick/scripts/scan_real_secrets.py` illustrates fixture coverage and precise token shapes.
`references/orca/config/scripts/pty-transcript-secret-scan.mjs` illustrates transcript redaction.
Neither is a universal detector, and finding a secret does not revoke it. Provide rotation guidance
when a credential may have left the machine, without attempting provider account changes automatically.
