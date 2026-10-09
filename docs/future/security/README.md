# Harden the trust boundaries

Updated: October 9, 2026. Phases 01, 02, and 04 through 09 are implemented and integrated.
Phase 03 (Node 26) is excluded from this branch; Phase 10 is deferred at the owner's request.
Each phase's completion notes record the shipped behavior, acceptance evidence, and limitations.
Trust-boundary source baseline, phases 01 to 05: `823db58295b84ac9f9fb52f3f85b7a6550bd8761`.
Agent-tooling source baseline, phases 06 to 10: `079f5c948161ea8213bcdb25fe2fbefccab7d6f1`.

This programme contains ten product requirement documents (PRDs). Phases 01 to 05 harden the core
and plugin trust boundaries. Phases 06 to 10 add instruction review, security diagnostics, dependency
review, managed MCP installation and review, and secret publication checks. Give each PRD to its owner;
each includes starting points, authority, data flow, limits, and acceptance checks.

The trust-boundary review compared the October 1, 2026 baseline in
[the dated review](../../security/review-2026-10-01.md) with its follow-up source baseline. The tooling
phases use the October 8, 2026 survey of Acorn and reference apps. The historical requirements below
do not claim that every inspected application is vulnerable or that these controls contain arbitrary code.

## Product goal

Every trust boundary enforces itself through a mechanism a reader can point to, not through a
coincidence of platform behaviour. A desktop command checks its caller. The plugin network and
filesystem limits survive hostile plugin code. A node that leaves loopback does not widen what a
leaked token can do. When a control is defence in depth rather than the primary guard, the code says
so instead of claiming more.

The reviewed scope is the Tauri desktop shell, the Node service and its transport, and the loaded
plugin seam. The threat actors are a malicious or compromised third-party plugin, prompt-injected
agent code holding a task token, and a local process on the owner's machine. Acorn stays single-owner
software, so none of this adds multi-user roles. It closes the gap between what a boundary claims and
what it enforces.

The tooling goal is to make changes to agent inputs, executable packages, and published content
reviewable at the operation Acorn owns. Owner-enabled mandatory gates stop on incomplete checks.
Diagnostics distinguish configured intent from observed enforcement. Full host agent execution remains
available; this programme adds no restricted agent execution mode, container backend, or credential proxy.

## Execute the phases

Phases 01 to 05 can proceed independently. Phases 02 and 03 both touch the loaded plugin realm, so
read them together and build 02 first: phase 03's runtime leaves hostnames and SQLite to phase 02. That plugin-worker
runtime work is distinct from the agent execution mode excluded from this programme.

For tooling, implement phase 06 first, then phase 07's independent diagnostics, phase 08, phase 09,
and phase 10. Phase 07 can start independently and integrate other phases as their contracts ship.
Phase 06 may use phase 10's detector for redaction after phase 10 lands; it does not wait for it.
Complete each phase's acceptance before calling it done. Do not create a branch or delegate without
the user's request.

| Phase | PRD | Outcome | Relationship |
| --- | --- | --- | --- |
| 01 | [Gate desktop commands by caller](./01-desktop-command-authorization.md) | Acorn's own Tauri commands require the main webview or check their caller, so plugin and preview origins cannot reach them. | None |
| 02 | [Make the plugin realm policy tamper-resistant](./02-plugin-realm-intrinsics.md) | The network and builtin allowlists survive a plugin that rewrites shared intrinsics. | Before 03 |
| 03 | [Move the bundled runtime to Node 26](./03-runtime-network-and-fs-backstop.md) | The runtime refuses sockets to plugins with no network grant. Hostnames and SQLite still rely on 02. | After 02 |
| 04 | [Confine and time-bound internal tokens](./04-internal-token-confinement.md) | A node on the network refuses internal tokens from remote peers, and a leaked token expires. | None |
| 05 | [Fence the automation driver out of releases](./05-automation-driver-release-fence.md) | The WebDriver automation server cannot ship in a release build, and refuses cross-origin callers if it runs. | None |
| 06 | [Review changed agent instructions](./06-instruction-review.md) | Bounded instruction discovery, hash-bound review, and mandatory admission that stops on incomplete checks. | First tooling phase |
| 07 | [Explain the effective security controls](./07-security-diagnostics.md) | On-demand, device-only diagnostics with evidence, coverage, unknown states, and repair actions. | Integrates 06, 08, and 09 |
| 08 | [Explain dependency and install-policy changes](./08-dependency-review.md) | Revision-bound npm and pnpm reviews in Changes, including sources, integrity, and policy weakening. | Advisory; supplies policy facts to 07 |
| 09 | [Pin MCP packages and review tool changes](./09-managed-mcp-review.md) | Frozen npm MCP installations and optional review enforced on the harness's actual server connection. | Reports management and coverage to 07 |
| 10 | [Check secrets before publication](./10-secret-publication-checks.md) | Local secret detection and optional digest-bound gates for Acorn-owned publication actions. | Can supply redaction to 06 |

[Scope boundaries](./refused.md) records what this programme leaves out and why, including the parts
of the plugin threat model that need operating-system sandboxing rather than a code change.

## Establish the developer's baseline

Before implementation, read this index, the selected phase, and its owning reference docs. Compare
the phase's source paths and contracts with the checkout. A moved file follows its feature owner;
a shipped fix is verified and omitted from the implementation rather than duplicated.

Phase 06 also assumes the working-tree changes in `instructionCheck.ts`, its test, and
`docs/security.md`. Verify whether they were committed or otherwise included in the developer's
checkout. Preserve their Unicode, import, decoding, and quota behaviour. They do not make the proposed
review feature complete. Keep source-baseline evidence separate from the phase's implementation status.

Use [conventions](../../conventions.md), [testing](../../testing.md), and
[writing docs](../../writing-docs.md). Keep policy logic beside its feature, entrypoints thin, wire
contracts typed, and mutable state owned once. Use contribution and capability seams for cross-plugin
work. Add a dependency only after checking the installed tools and its shipped cost.

## Ownership and invariants

Trace each boundary from the caller through the gate to the asset it protects. Use these owners:

- `apps/desktop/src-tauri/` owns the shell: the Tauri commands, the webview and scheme handlers, the
  capability files, and the vendored automation driver.
- `packages/node-core/src/server/plugins/` owns the loaded plugin worker realm, its launch grants,
  and the network and builtin policies.
- `packages/protocol/src/plugin/nodeBuiltins.ts` owns the builtin-family policy shared by the ESM
  resolver, the scoped require, and `process.getBuiltinModule`.
- `packages/node-core/src/server/auth/` owns the internal token format and its verification.
- `packages/node-core/src/server/transport/` owns the listener and which hosts it answers to.
- `plugins/agents/src/server/` owns instruction admission, harness and MCP diagnostics, server lifecycle,
  session serialization, and provider-send checks. Its client contributes through `core:security`.
- `plugins/changes/src/server/` owns revision selection, dependency comparison, and Git publication checks.
- Core owns secret custody, project identity, authentication, confined reads, and the audit vocabulary.
  Feature plugins request specific operations through public contracts rather than broad service access.

These invariants hold across the programme:

- A control the docs present as an allowlist must be enforced where plugin code cannot reach it, or
  the docs must downgrade it to defence in depth and name the real guard.
- A change preserves existing behaviour for the legitimate callers each boundary serves: the main
  renderer, the node's own loopback calls, and the task-scoped agents.
- No phase claims an operating-system isolation property the runtime does not provide. Rung 3 in
  [the plugin security model](../../security/node-plugin-security.md) remains the owner of that.
- Device-only review protects API authority. It does not protect the Node's database or approval files
  from arbitrary code running as the owner. Diagnostics and reviews state that residual limit.
- Approvals bind reviewed bytes, scope, operation, and comparison version. A stale view cannot authorize
  changed input. Optional hooks retain their documented failure behaviour; mandatory gates live at admission.
- Reports, diffs, errors, audit details, and telemetry contain no credential values or raw environment dumps.
- Existing configuration, sessions, plugin approvals, and worktrees migrate without resets. Optional review
  and blocking features start off for migrated data. No phase rewrites personal harness settings.

## Combined acceptance

### Integration handoff: October 9, 2026

Phases 01, 02, and 04 through 09 landed sequentially on `security-phase`. The combined review
corrected the plugin ownership golden for the instruction-review and diagnostics routes and the
Changes static-policy capability. Focused regeneration passed 14 tests; the normal ownership run
then passed all 13 tests against the corrected golden.
The Phase 05 note now attributes the earlier service-budget increase to Phase 04's renewal lifecycle.
The final focused documentation checks passed all six tests, and `git diff --check` passed.

The final full gates ran once with tooling Node 26.9.0; the bundled runtime remains Node 24.21.0.
`pnpm lint` passed all 37 tasks. `pnpm test` completed all 36 tasks, with 33 passing. This included
1,686 Node core tests, 1,333 agents tests, 304 Changes tests, 570 workflow tests, 722 TUI tests,
87 architecture tests, 203 desktop JavaScript tests, and 67 Rust tests. The production service
graph passed at 3,209,061 bytes against its 3,210,000-byte ceiling.

After the ownership golden correction, the remaining failures are outside the security changes:

- The unchanged published plugin manifest schema lacks the contract's `search` property.
- The unchanged diff-viewer test left a resident segment provisional in its timing assertion.
- The Node route golden lacks the existing GitHub `pulls/search` route.

These failures were left untouched at the owner's request. The full test gate is therefore not green.
No packaged installer or separate Runn development workload was exercised in this final pass.
Phase-specific desktop and installed-harness evidence remains in the completion notes. Codex 0.159.2
needs a new managed session to see an MCP catalogue approved after its initial empty list.

### Release workflow

Each developer runs the phase's focused tests, `pnpm lint`, affected package and consumer suites,
and `pnpm --filter @acorn/arch-tests test`. Complete the full `pnpm test` gate before the programme's
release handoff. Use the capped script rather than invoking Turborepo directly.

For UI work, use `pnpm dev:agent -- --session security-handoff` and the matching
`pnpm dev:agent:ui` commands from [the driver guide](../../local-development/agent-drivers.md).
Check Node switching, stale reviews, cancellation, and actionable failures in the real app, and stop
the session afterward. Do not call a native dialog or child-webview refusal verified merely because
the renderer driver passed. Provide terminal behaviour through shared components or an explicit fallback.

Before release, exercise an ordinary Runn development task in a disposable checkout: install from its
lockfile, start the application and database dependencies, run its tests and browser checks, and use
the normal Git workflow. With optional gates off, the tooling must not alter those operations.
With gates on, use synthetic changed instructions, package metadata, MCP tools, and credential fixtures
to verify the expected review and refusal paths. Never use real secrets or push fixtures to a provider.

Record installed harness and package-manager versions, supported formats, execution paths that remain
uncovered, and any manual checks that could not be completed. A diagnostics pass is not a containment test.

## Relationship to the shipped security model

The owning documentation is [the security model](../../security.md) and its topic pages. Where a phase
changes a shipped control, it updates the page that owns it in the same change. Phases 02 and 03 refine
controls the [node realm page](../../security/plugin-node-realm.md) already labels as a resource
boundary rather than a hostile-code sandbox, so they tighten what the realm claims rather than
contradict it.
