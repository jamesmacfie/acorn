# Phase 01: contributed omp harness

Status: proposed, 2026-10-03. Entry: [shared execution rules](./README.md) read. Next:
[phase 02](./02-permission-veto.md).

## Outcome

An owner can select `omp` as a loaded ACP harness and use Acorn's session, permissions, worktree,
and transcript surfaces. This phase establishes which deep agent-loop features can remain in `omp`
instead of becoming Acorn features. Source design: [omp harness](../01-omp-harness.md).

## Ownership and data flow

Installed manifest → core harness registry → agents provider/profile → generic ACP driver → `omp`
process. ACP updates become driver events, durable agents rows, lifecycle frames, broker query
invalidations, and the shared desktop/terminal session UI. OAuth credentials remain in `omp`'s store.

Start with these owners:

- `plugins/agents/src/server/drivers/acpDriver.ts` and `acpSession.ts`.
- `plugins/agents/src/server/drivers/harness.ts` and `registry.ts`.
- `plugins/agents/src/contract/sessionExecute.ts` and the managed execution implementation.
- [Harness manifest contract](../../../plugin-authoring/the-manifest.md#harnesses).

The checked execution contract maps built-in profile IDs through `managedProviderForProfile`.
Do not assume a contributed ACP profile also runs through workflow steps because it works in the
Agent pane. Inspect workflow admission and fallback behavior explicitly.

## Implementation

1. Pin an `omp` version and inspect its ACP initialization, help, authentication, permission mode,
   extension loading, and resume behavior. Record protocol evidence, including elicitation forms.
   Treat the 2026-10-02 comparison as research to verify, not an external API specification.
2. Create a standalone harness-only loaded package from the scaffold. Keep runtime ID `omp:omp`,
   `spawn.command: 'omp'`, `args: ['acp']`, and `envPassthrough: ['OMP_*']`. Copy baseline and API
   version from the scaffold. Supply a real icon. Keep `sessionPersistence: false` and omit `oneShot`.
3. Run an interactive session through prompt, edit, permission request, structured question, model
   selection, Node restart, and resume. Capture native `read`, `edit`, and `bash` behavior, rather than
   advertising Acorn filesystem or terminal callbacks that it does not implement.
4. Run a delegated session and a workflow agent step. If a built-in profile mapping excludes the
   contribution, resolve it through the public harness registry at the owning admission layer.
   Preserve existing built-in behavior and the absence-of-managed-driver fallback. Do not add an
   `omp` special case to workflows or widen plugin access to runtime internals.
5. Enable one `omp` extension or stream rule and its advisor using the verified configuration door.
   Record the ACP transcript representation. Check nested worktrees, task archive cleanup,
   provider-native subagent reporting, stdout contamination, and operation without Bun on `PATH`.
6. Keep protocol fixes bounded and separately reviewable. Fix a reusable generic-driver behavior,
   with a protocol fixture, rather than encoding unexplained manifest quirks. If a protocol feature
   cannot work, record the limitation and continue phase 02 with the supported harness roster.

Do not claim terminal continuation until it reopens the same conversation. Do not add broad provider
environment passthrough, auto-approval flags, a private agent loop, or a tool-enabled one-shot backend.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Add focused ACP or registry
coverage only for repository changes. Exercise real desktop and terminal sessions, not just a
successful manifest parse. Acceptance requires:

- The package installs and survives Node restart without a client or Node bundle.
- Allowed and rejected permission requests both return to the harness.
- Resume, forms, model choices, delegated execution, and workflow admission have recorded outcomes.
- Archive cleanup and extension-generated protocol traffic have an explicit disposition.
- Every unsupported capability has evidence and a visible limitation; none is silently claimed.

## Documentation and handoff

Update [harness authoring](../../../plugin-authoring/the-manifest.md#harnesses),
[managed agents](../../../managed-agents.md), and
[agents/provider acceptance](../../../testing/agents-and-providers.md) with verified behavior.
Record the standalone package revision and the provider capability matrix here. That matrix supplies
the `omp` cases for later phases; a blocked `omp` installation must not erase Claude/Codex acceptance.

## Verify before building

Check whether `omp` is installed and signed in, the manifest baseline, generic ACP authentication
handling, `session/load` versus `session/resume`, and contributed-profile execution admission.
Inspect the external project's supported flags and pin the exact tested version.
