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
explicit and does not enter those caches. A 70-file fixture with long metadata, binary
content, and tracked plus captured-untracked text exceeding the combined patch budget
measured at most 60 summaries, 12 KiB metadata, and 40 KiB combined patch input; each
excluded category was named. Production Node service is 3,197,524/3,200,000 bytes;
terminal startup after the paired-node fix is 729,607/730,000 bytes.

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
failure, retry, and a recovered answer. `git-phase04-scope-tui` at 120×40 selected
**Fixture answer** before each Generate. Its SGR mouse input opened the action; `h`
then `j` switched from revision `5b4a53f3` to `fec50ff4` while generation was visible.
The root showed **Explain commit** without the delayed answer. A second slow call on
the root was followed by `ctrl+k`, **Switch node**, and the paired remote fixture;
the remote's own History 3 and task sentinel appeared, with no local explanation.
The model process log recorded cancellation in 20,656 ms, and switching back still
showed no late result. The driver input trace is in the isolated session's
`.acorn/agent-dev/tui/git-phase04-scope-tui/logs/input.jsonl`; the desktop screenshot
is `.acorn/agent-dev/git-phase04/screenshots/git-explanation-root.png`. Reproduce
the mouse action with `dev:tui:agent:ui type $'\033[<0;44;14M\033[<0;44;14m'`,
then use the driver `press` and `snapshot` commands above. One earlier terminal
driver click inadvertently used Claude Code before the fixture was selected;
ordinary automated tests and these follow-up checks made no paid model call.
All isolated desktop, terminal, and standalone Node sessions were stopped.

**External replacement:** The source checkout at
`/Users/jamesmacfie/Source/acorn-worktree-manage` identifies its plugin as
`worktree-manager` with source `worktrees`; it was preserved. No external registration
was installed on either the selected local Node or the connected disposable second
Node when their public **Installed** inventories were read. The actual source remains
plugin API 2 and the API 3 installer rejected its built package; that checkout was
not altered. An API 3 fixture with the same verified ID was installed only on the
second Node. Its plugin database held a sentinel. The remote Git source showed a
three-commit history, captured-untracked stash, three worktrees, and a task worktree;
the local Node's two-commit project and registration inventory remained separate.
Remote built-in Git was disabled through public management and the isolated Node was
restarted: its effective status was **Off**. No external retirement was attempted
while Git was unavailable. Git was reenabled and the Node restarted; its history,
stash, worktrees, and task remained. The fixture was then uninstalled on that Node
through public **Keep its data**, followed by another restart. The fixture registration
became **Not installed**, its plugin database sentinel survived, and all Git/task
sentinels remained. The local Node still had active Git and no `worktree-manager`.
No actual external registration existed to retire, so none was disabled or removed.
The source checkout, unrelated preferences, and repository data were preserved.
Replacement is per Node: verify that Node's built-in Git is effective after restart,
then retire only a verified installed `worktree-manager` on that same Node.

**Verification:** Git plugin suite passed (13 files, 49 tests), including the expanded
real Git budget and abort fixtures, empty-result retry, model validation, provider
error, and Git process truncation. Git, Node, desktop, terminal, client-core, and
plugin-api type checks passed; terminal was rechecked after the saved-node broker
fix. Touched-source oxlint and relevant architecture boundaries, doc paths, source
fields, and published plugin surface passed. The terminal production build passed
startup and runtime-import checks. The saved-node fix was also exercised in the
connected terminal host: its public Node switch reached the second Node's own Git
history instead of reporting **Unknown node**.
The sole architecture failure is unchanged `docs/api-reference/plugin-routes.md` at
201 lines against the 200-line limit. Root lint and full `pnpm test` were deliberately
deferred to the coordinator's all-eight-phase gate. The unrelated AgentPane turnId,
workflowMapLifecycle HeadlessArgv, and worktree GET-body failures were not changed.

**Later phases:** Phases 05–08 remain planned. If a real external
`worktree-manager` registration is installed on a later Node, repeat the per-Node
identity, replacement, and non-purging retirement check there. The API 2 source
requires its own compatibility work before it can install on an API 3 Node.

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
