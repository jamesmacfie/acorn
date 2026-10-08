# Phase 06: review changed agent instructions

Completion note, October 9, 2026. **Status: implemented.** The agents plugin now discovers
repository instruction files, imports, repository skills, delivered plugin skills, and supporting
files with one bounded scanner. The runtime applies enabled checks at the shared queued-turn
dispatch point before a driver send. A device-only review route stores encrypted snapshots in the
agents database, compares changed bytes and canonical paths, and rejects approval drift. Settings
offers separate hidden-character and changed-instruction switches. The review shows advisory
findings before collapsed, credential-redacted diffs. Project deletion removes its snapshots.

The installed harnesses inspected were Claude Code 2.1.294 and Codex 0.159.2. The exact scanner
scope, exclusions, quotas, and host-access limits are recorded in
[instruction file checks and review](../../security.md#instruction-file-checks-and-review) and
shown in the review. Acorn scans nested Claude and Codex instruction names before the harness
visits those directories. It follows Claude imports through five hops, enters repository and
delivered plugin skill folders, and reports unsupported skill formats. Instruction approval stays
separate from plugin-skill and executable-config trust. The optional `agents:before-send` hook keeps
its fail-open extension contract; mandatory checks run directly in the dispatcher. The service
budget ceiling is 3,186,000 B for a measured 3,184,959 B combined build. No runtime pin or CI
runtime line changed.

Acceptance evidence: the focused scanner, hidden-character, admission, encrypted store, device
route, settings UI, and 20 durable queue tests pass. The queue tests cover interactive, workflow,
delegation, delegation report, automation, import, plugin, and goal sources, plus cancellation.
The workflow consumer suite passes 570 tests; focused Node core secrets, hook, and project tests
pass 45 tests. Plugin TypeScript, 87 architecture tests, database migration checks, and the Node
service build pass. The Node route registry passes 35 of 36 tests; the only golden mismatch is its
pre-existing missing GitHub pull search route. This phase's six mounted review-route entries are in
the golden list. An isolated desktop session showed first-use
refusal, baseline approval, added command and domain findings after a file change, a stale-review
approval conflict, and refusal of a subsequent managed turn. The isolated session had one Node, so
the real desktop Node-switch case was not exercised; a settings UI test verifies that switching
Nodes clears the pending review and prevents a cross-Node approval. The agents suite previously
passed 1,276 tests with one unrelated sandbox process-inventory failure. The broad Node core suite
was stopped after unchanged loopback and socket tests failed or timed out under this sandbox. No
full repository test or lint run was made; the coordinator owns that gate.

Phase 07 can add harness-configuration diagnostics without changing this snapshot approval.
Phase 10 can replace the local credential-pattern redactor with a shared detector; the UI consumes
only redacted patches and never stores displayed secrets in preferences or audit details.

Original proposal, October 8, 2026.
Source baseline: `079f5c948161ea8213bcdb25fe2fbefccab7d6f1`, plus the uncommitted instruction-check
changes described below. Dependency: none of phases 01 to 05.

This phase adds review of changed instructions and skills, and makes an enabled instruction check
stop a turn when it cannot complete. Give this document to the developer owning agent admission.

## Problem and outcome

The instruction checker finds invisible characters before Acorn sends a turn. It does not identify
a visible instruction that adds a command, reads credentials, changes permissions, or sends data away.
Repository instructions can change without the owner seeing the change before a harness reads them.

The working tree at the source baseline also contains changes to
`plugins/agents/src/server/sessions/instructionCheck.ts`, its test, and `docs/security.md`.
They expand Unicode coverage, follow imports and linked skill folders, decode damaged text, and
refuse size and file-count limits. Preserve and verify those changes before building this phase.
They are baseline input, not acceptance evidence for the proposed work.

The outcome is an optional review of instruction changes, with a readable diff and specific findings.
An enabled required check returns checked, blocked, or incomplete. Incomplete stops admission and
explains how to retry or change the setting. The UI never presents an incomplete scan as a pass.

## Starting points and owners

Read these owners and their colocated tests:

- `plugins/agents/src/server/sessions/instructionCheck.ts` owns discovery and hidden-character checks.
- `plugins/agents/src/server/sessions/runtime.ts` owns interactive and operation-owned turn admission.
- `plugins/agents/src/node/index.ts` registers the checker on `agents:before-send`.
- `plugins/agents/src/shared/sessionDefaults.ts` and
  `plugins/agents/src/server/sessionDefaultsStore.ts` own device-editable Node preferences.
- `plugins/agents/src/client/settings/AgentSecuritySection.tsx` draws the security settings contribution.
- `packages/node-core/src/server/plugins/skills.ts` and
  `packages/node-core/src/server/plugins/skillState.ts` own plugin skill validation and approvals.
- `packages/node-core/src/server/repoConfigTrust.ts` owns executable repository config trust.
- `packages/node-core/src/server/pluginHost/hooks.ts` owns optional hooks that continue after failure.

Read [skills](../../managed-agents/skills.md), [process and configuration controls](../../security/process-and-paths.md),
and [the instruction check](../../security.md#instruction-file-checks-and-review).

## Required behaviour

Keep the hidden-character setting and add a separate **Review changed instruction files** setting,
off by default. Both settings are per Node and device-editable. A task or service principal cannot
approve a review, dismiss a required finding, or change either setting.

Discover root and nested instruction files using the installed harness's documented names and
precedence. Include imports and repository skill folders. Bound discovery by directories, files,
bytes, depth, and elapsed time. Exclude dependency and Git object trees deliberately, and disclose
the exact scope. Do not execute project commands or load project configuration code to discover files.
Follow links only through the established scanner policy, deduplicate canonical paths, and refuse
cycles, special files, unreadable present inputs, and exhausted limits as incomplete. Missing optional
files are allowed. An absent file and a present file that cannot be inspected have different outcomes.

The review lists added, changed, removed, and retargeted files since the owner's last approved
snapshot. First use asks for a baseline review. Display invisible code points by name and location;
render all input as escaped text. Findings identify commands, external domains, sensitive paths,
permission changes, and instruction override phrases. Keep ambiguous language advisory. A security
guide mentioning credential theft is not proof that it instructs theft.

Approval does not require the owner to open every file. Decided October 8, 2026: findings appear
first and each file starts collapsed, so approving without reading the rest is an informed choice.
Forcing a scroll through every file teaches the owner to scroll past them.

Keep analyzers deterministic and bounded. Start with text rules and reviewable shell patterns;
do not build a general malware detector or spend model tokens automatically. Supporting scripts in
skills belong in the review. Unknown executable formats report unsupported analysis rather than clean.

Approvals bind the project, canonical input identities, byte digests, discovery scope, and analyzer
version. Recompute before accepting the displayed snapshot and before sending a turn. A changed byte,
added file, removed file, or link target invalidates that review. Return a conflict if input changes
between display and approval. Approval does not suppress the enabled hidden-character check.

Keep instruction, plugin-skill, and executable-config approvals separate. Show each in its owning
review with a link to the others. A review of an instruction cannot authorize a run target or a plugin.
Global harness hooks and MCP configuration appear as diagnostics in phase 07; this phase does not
rewrite or approve the person's harness configuration.

## Admission, storage, and limits

Move mandatory scanner admission into the agents runtime before a prompt reaches the driver.
Keep optional plugin hooks under their established failure behaviour. Do not make every hook fail
closed to implement this one security gate. Apply the admission to interactive, workflow, delegated,
and resumed turns. A bounded timeout becomes an incomplete refusal, and cancelled scans stop work.

Give snapshot state one owner in the agents plugin. Keep at most the last two bounded snapshots per
project, encrypted at rest through core's secret service; never store instruction bodies in prefs,
audit details, or telemetry. Cap each snapshot at 8 MiB and remove state when its project is deleted.
Persist approval metadata and digests separately. Failure to decrypt means review required.
Redact credential-shaped spans in displayed diffs. Phase 10 can supply a shared detector when it ships.

A pre-turn scan does not intercept a file a harness loads or changes during a turn. State this limit
in the review and shipped docs. Global instructions outside the discovered scope are not covered.
These controls also do not protect on-disk approval state from a process with the owner's host access.
Acorn does not add an operating-system sandbox in this phase.

## Implementation sequence

1. Verify the uncommitted scanner changes and inventory the installed harnesses' discovery rules.
2. Separate bounded discovery, byte snapshots, pure analyzers, and approval storage beside agents.
3. Add direct runtime admission, then device-only review and approval routes with typed wire schemas.
4. Extend the agents security section and render the review using Acorn's shared components.
5. Update the owning reference docs and record the scope each harness can actually cover.

Do not widen plugin APIs or import core internals into agents. Add a narrow core contract only if the
secret service or project lifecycle lacks the operation this phase demonstrably needs.

## Acceptance and verification

Prove these behaviours with fixtures and route-level tests:

- An enabled check stops a turn on a read failure, scanner error, timeout, or quota breach.
- A disabled check preserves turn behaviour. An optional plugin hook failure preserves its contract.
- Nested instructions, imports, UTF-16, damaged UTF-8, linked skills, and emoji retain their intended checks.
- A file or link changed during review rejects approval. Added and removed files invalidate the baseline.
- Approval from another project, task, or Node cannot authorize the snapshot. Task and service writes get 403.
- Workflow and delegated turns reach the same gate. Cancellation leaves no scan running or pending approval.
- Legitimate security prose produces an advisory finding. Secret-shaped text is absent from logs and diffs.
- Restart restores the approved metadata, and missing or unreadable encrypted state requires review.

During iteration, use `pnpm test:focus @acorn/plugin-agents src/server/sessions/instructionCheck.test.ts`.
Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-agents --filter=@acorn/node-core --filter=@acorn/plugin-workflows`,
the suites of any additional consumers changed, and `pnpm --filter @acorn/arch-tests test`.
Use [the desktop driver](../../local-development/agent-drivers.md) to review a changed file, approve,
change it again, and observe refusal. Switch Nodes while a review is open and prove no cross-Node write.
Finish with the driver's stop command. Update `docs/security.md` and the managed-agent topic pages.

## Research and trade-offs

The deterministic rules in `references/deer-flow/backend/packages/harness/deerflow/skills/skillscan/orchestrator.py`
are examples of findings with locations and remediation. Do not copy its broad blocking rules wholesale:
valid Acorn skills execute scripts and discuss sensitive operations. Review adds interruptions only
when the owner enables it, and content hashes limit repeated review of unchanged inputs.
