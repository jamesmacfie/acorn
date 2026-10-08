# Phase 04: explanations and first release

## Completion note, October 9, 2026

**Status:** Implemented on `phase-4-explanations-and-first-release`. The built-in Git
source now offers explicit **Explain commit** and **Explain stash** actions in desktop
and terminal history and stash detail. They use the public Node model service, Acorn's
shared backend/model picker and generation preference, and a paired-device route. The
Node validates the selected backend and model, resolves the project repository, and
checks immutable commit/stash and comparison IDs. Repository messages, paths, and
patches are JSON data separate from the system instruction that treats them as
untrusted. No selection or refresh generates text, and no task transcript, agent
session, or checkout mutation is involved.

**Bounds and lifetime:** Context has at most 60 file summaries, 12 KiB of metadata,
40 KiB of combined patch text, and 700 output tokens. Captured untracked stash content
enters the remaining patch budget. Missing, binary, clipped, and unavailable content
is named. The client retains at most 16 answers by Node, project, kind, object,
comparison base, backend, and model. Scope/model changes and disposal abort the
request and reject late output; cancel, unavailable model, provider failure, empty
answer, and retry have visible states. The existing Phase 02 2,401-commit fixture
measured a 53.57 ms/four-process first 100-row page, 57.97 ms/four-process next page,
39.02 ms/four-process topology, 17.75 ms/two-process first diff segment, and a one-entry
183-byte parsed cache. Those unchanged history/diff paths and Phase 03 bounded stash
roster and checkout admission tests remain applicable. The new explanation request is
explicit and does not enter those caches. Production Node service is
3,197,524/3,200,000 bytes; terminal startup is 729,585/730,000 bytes.

**Real hosts:** Isolated desktop `git-phase04` used the disposable two-commit, 22-file
repository and a captured-untracked stash. A locally installed one-shot model fixture
appeared beside Claude Code and Codex in the shared picker. The desktop showed
generation, cancel, provider failure then retry, retained revision-scoped answers,
and a cancelled request when the selected revision changed; the service logged its
abort in 8,264 ms and late output did not appear under the new selection. After the
final build it showed a complete, wrapped answer with named binary and 40 KiB patch
omissions. Isolated terminal `git-phase04-tui` selected the same fixture model and
showed the stash answer, captured-untracked file, and named omissions at 120×40.
`git-phase04-tui2` showed commit model choice, generation, cancellation, provider
failure, retry, and a recovered answer. One terminal driver click inadvertently
used Claude Code before the deterministic fixture was selected; ordinary automated
tests made no paid model call. All sessions were stopped. The terminal driver did
not successfully switch selected history rows during generation; desktop host and
shared client state tests cover late scope output, so independent terminal scope
acceptance remains open.

**External replacement:** The source checkout at
`/Users/jamesmacfie/Source/acorn-worktree-manage` identifies its plugin as
`worktree-manager` with source `worktrees`; it was preserved. No external registration
was installed on the disposable Node initially. The public installer rejected the
actual built package because it uses plugin API 2 and this Node accepts API 3. An
isolated API 3 identity fixture with the verified plugin ID was installed, disabled,
and uninstalled via **Keep its data**; no real external registration was removed or
purged. The public management contract takes an explicit Node ID for remote writes,
and the UI labels the local target. No remote Node was connected in this fixture, so
remote acceptance was limited to contract review. Built-in Git was toggled off in the
disposable Node; its status said it remains active until restart. It was restored,
and no unrelated activation or layout preference was changed. On each actual Node,
verify built-in Git first, then retire only an installed `worktree-manager` there.

**Verification:** Git plugin suite passed (13 files, 46 tests), including real Git
fixtures for bounded context, captured untracked content, model validation,
cancellation, provider error, and the Git process truncation flag. Git, Node, desktop,
terminal, client-core, and plugin-api type checks passed. Touched-source oxlint and
the relevant architecture boundaries, doc paths, and published plugin surface passed.
The sole architecture failure is unchanged `docs/api-reference/plugin-routes.md` at
201 lines against the 200-line limit. Root lint and full `pnpm test` were deliberately
deferred to the coordinator's all-eight-phase gate. The unrelated AgentPane turnId,
workflowMapLifecycle HeadlessArgv, and worktree GET-body failures were not changed.

**Later phases:** Phases 05–08 remain planned. A compatible external package and a
connected remote Node are needed to complete real-package and remote replacement
acceptance. Repeat terminal-specific scope-change acceptance with a stable fixture
driver if the release gate requires independent host proof.

Original plan dated October 7, 2026.
Depends on [phase 03](./03-stashes.md).
Read the [full implementation context](./README.md), especially
[AI explanations](./README.md#ai-explanations),
[replacement](./README.md#replacing-the-external-plugin), and
[verification](./README.md#verification-strategy).

## Deliverable

The first Git client release supports worktrees, recent commit history, stash management, and
explicit commit/stash explanations on desktop and terminal. It can replace the external plugin
without removing any Git data or task records.

## Steps

1. Add explicit explanation routes using Node model services, validated backend/model picks,
   bounded metadata and patch context, and named omissions. Include captured untracked stash
   content where it fits the budget. Keep repository text separate from model instructions.
2. Reuse the shared model/backend picker and generation default. Add generating, cancel,
   unavailable model, provider failure, empty result, retry, and late-response handling. Retain
   results by revision/model without rewriting commit metadata or task transcripts.
3. Exercise all first-release flows in isolated desktop and terminal sessions. Measure initial
   history load, page growth, diff requests, cache bounds, and cleanup on Node/task changes. Fix
   failures in the owning slice before calling the release accepted.
4. Test replacement using the public plugin management flow. Disable or uninstall the verified
   external `worktree-manager` registration without purging data after the built-in replacement
   passes acceptance. Retain its source checkout and unrelated activation/layout preferences.
   Describe **Git > Worktrees** navigation and per-Node replacement in the shipped docs.
5. Update feature references, public contract docs, plugin map, documentation index, relevant
   goldens, and dated host evidence. Record the first-release boundary; leave phases 05–08 planned.

## Acceptance

- Model service tests verify correct backend/model selection, bounded input, omission reporting,
  cancellation, and provider errors without paid calls in ordinary tests.
- Both hosts show explicit generation and model choice, cancellation, retry, and selection/Node
  changes without late output appearing under another revision.
- Replacement passes with no external installation, an installed external plugin, a remote Node,
  and built-in Git disabled. No task, repository, worktree, stash, or plugin data is purged.
- Run affected package/consumer suites, `pnpm lint`, architecture gates, and full `pnpm test`.
  Attach real desktop/terminal evidence for the first release; mocks alone do not complete it.

## Verify before building

- Recheck model cancellation propagation through the transport and backend implementation.
- Verify plugin identity, non-purging removal, running-versus-installed state, and remote-Node
  authorization in the selected release baseline.
