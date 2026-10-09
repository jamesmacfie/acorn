# Phase 06: refs, remotes, comparison, and settings

Date: October 7, 2026. Status: complete October 9, 2026.

## Coordinator verification — October 9, 2026

Phases 01–06 are integrated into `git-pane`, including `efcd88dab`. The coordinator repeated the
affected checks after integration: Core 63/63, plugin API 14/14, desktop client 26/26, TUI 22/22,
terminal security 2/2, HTTP 40/40, Workflows client 13/13, and the Git browser entry 1/1 passed.
Node integration passed 49/50; only the unchanged GitHub pull-search golden differs. Architecture
and documentation checks passed 64/65; only unchanged `plugin-routes.md` at 201 lines fails.
The earlier architecture subprocess timeouts did not recur. Touched-source oxlint, affected
package type checks, and the branch whitespace check passed.

After repairing staging and including the installed Rust toolchain in `PATH`, the complete desktop
package gate passed: 193 Vitest tests, 11 boot checks, and 66 Rust tests. The independent renderer
budget check reproduces 802,712/775,000 B; its documented baseline overage remains untouched.

The coordinator repaired ignored dependency links to resolve into this checkout's local virtual
store. The rebuilt Node graph matches the child at 3,194,881/3,200,000 B, confirming the earlier
overage came from foreign worktree paths in emitted module comments. The TUI graph is
731,655/732,000 B, and its external runtime imports resolve. No production cap changed.

The full root test and lint gates ran once. Related regressions were corrected; unrelated contract
fixtures, schema/golden drift, packed-scaffold dependency failures, EditorPane tests, and Workflows
authoring tests remain for separate work. The renderer cap was already exceeded at the campaign
baseline, as measured below. Phase 07 and Phase 08 are not started; the user requested a manual
Phase 07 handoff.

## Integrated gate fixes — October 9, 2026

The coordinator's first full gate exposed integration contracts that the isolated Phase 06 checks
had not exercised. Core's shared metadata queue now permits the established unbased lazy task
reservation when Git inspection is unavailable, using the checkout path as a fallback key and
rechecking the project mapping before admission. Pinned starts and metadata writes still require
verified Git identity. The three previously failing task-route cases and the direct Core callers
pass with the reservation and alias tests (63/63 focused). No checkout or task lifecycle moved
into Git.

Reviewed goldens now include Git's eight Node route ownership contributions, 33 plugin route
entries, the desktop Git pane/source/settings contributions, and the public plugin API exports.
The browser-realm task-draft entry is classified and imported under the Git client test host.
Terminal and HTTP security tests distinguish admitted read-only Git inspection from execution of
the requested user command. Workflow start tests verify the submitted launch callback before
navigation. The Core route reference moved its task-create field and identity detail into the
owning task-creation page, leaving `core-routes.md` at 194 lines with a working link. The TUI
startup assertion names the shipped 732,000 B cap; the viewport case checks the visible clipped
extension row; the Codex-plan case walks to the selected, clipped session title.

Focused results: Core 63/63; plugin API 13/13 plus Git browser entry 1/1; Node plugin-disable and
route registry 49/50 (the sole failure is the unrelated unchanged GitHub pull-search route missing
from its golden); terminal security 2/2; HTTP send 40/40 with loopback process access; Workflows
client start 13/13; TUI affected files 22/22; desktop client parity, disable, host, and task bridge
31/31; desktop renderer-budget tests 13/13. Narrow oxlint passed. Node Core, plugin API, Node,
terminal, HTTP, Git, desktop, and TUI type checks passed. Workflows type checking retains the
unchanged `workflowMapLifecycle.test.ts:222` null `HeadlessArgv` fixture error. Documentation
paths/citations passed 5/6; only unchanged `plugin-routes.md` at 201 lines fails the length rule.

Production builds in this worktree measured Node 3,194,881/3,200,000 B (101 static chunks) and
TUI 731,655/732,000 B (169 startup chunks). The coordinator's earlier Node staging measured
3,205,357 B because its `apps/node/node_modules` external package links (including `hono`,
`drizzle-orm`, and `vite`) resolved into this longer Phase 06 worktree: the emitted chunks contain
that foreign worktree path in module comments. Its local dependency links need repair before a
meaningful repeat budget check; source cuts or a higher cap would mask the staging fault. The
renderer still measures 802,712/775,000 B. The original campaign merge base measured
798,468 B with the same supported Node/dependencies, so 23,468 B of that overage predates the
campaign and the Phase 06 branch adds 4,244 B. The cap remains unchanged. The desktop constituent
tests and renderer build above ran without the blocked aggregate budget gate. No rendered behavior
changed in this integration pass; the prior rebuilt desktop and 80×24/120×40 terminal host
snapshots remain the layout evidence. Both isolated host session records say `stopped`.

The coordinator's other full-gate failures remain outside this scope: plugin-types contract
fixtures, packed create-acorn-plugin examples, EditorPane cases, two Workflows authoring cases,
and the unchanged GitHub route golden noted above. Phase 07 and 08 remain untouched.

## Final Phase 06 follow-up — October 9, 2026

Ref and remote mutations now retain the executed command's exit/error and the original repository
observation if the final roster cannot be read. Responses mark that roster as unavailable post-state;
the client invalidates its captured query key and does not cache the old observation as current.
The owning command path emits the shared Git/Changes invalidation after every attempted mutation,
including nonzero or aborted fetches that may already have moved some tracking refs. Ordinary
pre-command refusals return a fresh observation without a command; repository remaps retain the
original scope and mark its observation unavailable as current state. Remote reads compose request and
service-lifetime signals from project resolution through URL and identity inspection, and stop
before a later subprocess after cancellation. The metadata guard remains held through readback and
releases after a partial result. Ref and remote guard callback indentation was corrected.

Saving the auto-fetch preference now notifies the scheduler immediately after the authoritative
preference write. A later Git settings readback failure reports that the preference was saved;
disabling still aborts an in-flight discovery/fetch and a later opt-in works. No client read or
mount starts network work. The shipped feature documentation records the post-state and preference
failure contracts. No UI layout changed, so the inspected desktop and 80×24/120×40 terminal host
evidence below remains applicable; their session records remain stopped.

Narrow verification: 5 Git test files, 30 tests passed. Real disposable repositories cover ref
creation and remote edit with failed final inspection, and a local bare remote whose fetch updates
tracking refs before a controlled failure result. Controlled promises prove aborted fetch
invalidation, cancellation during repository discovery and guarded manual readback, no later
subprocess, metadata admission release, and disabling despite failed settings readback followed
by renewed opt-in. Git type check and changed-file oxlint passed; oxlint retains the existing
control-character-regex warning in the remote URL validator. Focused documentation architecture
checks passed 5/6; the sole failure is the unchanged 211/201-line route-document limit recorded
below. Payload caps were unchanged and no
host was rebuilt because no rendered behavior changed.

## Follow-up completion note — October 9, 2026

The review found late-response scope leaks, metadata races, an unguarded Changes pull,
auto-fetch cancellation gaps, and misleading forms. These are corrected in the owning layers.
Git client submissions now capture Node/project/cache keys and dialog generations before work;
late replies cannot replace a new dialog, settings draft, or task selector. Comparison resets on
a real scope change while retaining a pinned route during initial project hydration. The shared
Core repository metadata admission serializes branch reservations and Git ref/remote mutations by
canonical common directory. Branch ownership includes archived tasks whose archive is still in
progress, and incomplete Git roster/ownership reads refuse mutations. Changes now admits pull
through the checkout write guard and rechecks task, mapping, branch, operation, and clean state
inside it, for both its own UI and Git's public caller. Force push carries the upstream ID from
the armed action through confirmation even when a background fetch updates tracking status.

Auto-fetch claims a pass before its first await and propagates cancellation through discovery,
roster, and fetch. Disable and disposal stop new work. Git mutations and fetches emit the shared
status event to invalidate mounted Git and Changes views. Identity writes preserve per-field and
original-scope evidence after a subprocess or readback failure. Remote fetch URL edits use literal
Git config replacement, refuse multiple fetch URLs, and preserve push URLs. Non-commit tags show
their object type and cannot launch tasks/workflows. The comparison form visibly identifies
Source, Destination, Base, and optional commit IDs in both clients. The shipped route table now
lists settings GET and identity/preference PUT at their actual paths.

Focused follow-up verification: 10 Git test files, 35 tests; 3 Changes files, 47 tests; 2 Core
files, 18 tests. These include deferred Node/project/dialog/disposal responses, dirty settings
edits and partial retry, real Core branch reservation and archiving across aliases, local bare
remotes for guarded pull (fast-forward and rebase), force lease after tracking refresh, and
controlled simultaneous/aborted auto-fetch passes. Node Core, plugin API, Git, Changes,
client Core, and TUI type checks passed. Narrow oxlint found one newly unused import and it was
removed; its remaining warning is the existing remote URL control-character regex. Four focused
architecture files passed 62/63 tests; the sole failure is the unchanged route-document length
rule for `core-routes.md` (211 lines) and `plugin-routes.md` (201 lines). `git diff --check` passed.

Real host reproduction: the isolated desktop `git-phase06-review2` used the disposable
`/private/tmp/acorn-phase06-hosts-0God4B/desktop/repo` and bare remote. Its fresh post-fix
snapshots showed refs/remotes/settings, direct comparison of 2 files (`41852dc6` → `5c674821`),
and merge-base comparison of 1 file with base `b4046913`; inspected artifacts are
`.acorn/agent-dev/git-phase06-review2/screenshots/compare-review.png` and `settings-review.png`.
After the final comparison layout change, rebuilt desktop `git-phase06-followup-final` showed
the Source/Destination/Base selectors and both optional ID placeholders in a fresh snapshot and
inspected `screenshots/compare-final.png`. That final host used the worktree project, so the
comparison content proof is from the earlier post-fix fixture host, not the final layout rebuild.

The rebuilt terminal host `git-phase06-review-tui` used the sibling disposable `tui/repo` fixture.
At 80×24: Enter Git, Tab twice to tabs, `l` five times to Compare, `j` to Source, Enter and
`j` twice then Enter for local main; `j`, Enter, `j`, Enter selected local feature as Destination;
the same sequence chose shared merge base; `j` reached optional Source ID, Tab skipped each ID
to Pin, and Enter pinned. The snapshot showed direction `5c674821` → `41852dc6`, mode Shared
merge base → destination, base `b40469138b06d9`, and one changed `feature.txt`. Resizing to
120×40 preserved the pin and displayed the labeled controls and detail. Session input and ANSI
snapshots are under `.acorn/agent-dev/tui/git-phase06-review-tui/logs/`. Both terminal and final
desktop hosts were stopped. Earlier post-fix host snapshots covered refs, remotes, and settings;
the final host rerun targeted the comparison layout affected by the last edit.

Final measured startup payloads: Node 3,194,797/3,200,000 B; TUI 731,655/732,000 B; desktop
renderer 802,712/775,000 B (38 B above the first Phase 06 build and 121 B above Phase 05).
The desktop cap remains unchanged and its existing overage is a final branch integration concern.
Known unrelated failures remain the unchanged docs route-length rule, Agents fixtures lacking
`turnId`, and Workflows' null `HeadlessArgv` fixture. No Phase 07 or 08 work is included.

## Completion note — October 9, 2026

Refs, remotes, pinned comparison, scoped settings, and Node auto-fetch landed in that order. Git
owns repository projections and mutations; Changes retains task pull/push and its before-push hook.
The Git task actions call Changes' exported remote contract. Core still owns task checkout and
lifecycle, so selecting a ref only offers the phase 05 task/workflow launch callbacks.

Branch mutations recheck current object ID and canonical Git common directory, including project
aliases, other checkouts, and tasks with pending or archiving ownership. Manual fetch and remote
edits require explicit targets, reject helper transports, and return post-state. Force push uses
the remote object ID observed before the action in an explicit `--force-with-lease` argument; a
background fetch cannot silently advance that lease. Comparison URLs pin source, destination, and
base object IDs and expose direction and direct versus merge-base mode. Identity saves report each
field's result and readback for an explicit repository-local or Node-user-global scope. Auto-fetch
is off by default, runs only from the Node scheduler at a five-minute cadence, deduplicates Git
common directories, limits a pass to 128 projects and two repositories in flight, and aborts on
disable/disposal. Client mounting and refreshing only read state.

Focused evidence: Git 63 tests passed; Changes 272 passed and one skipped. The real bare-remote
tests cover manual fetch, both pull strategies, hook veto, stale and background-fetch-advanced
leases. Controlled-clock tests cover auto-fetch cadence, overlap, failures, alias deduplication,
and disposal. Git, Changes, protocol, client-core, Node, desktop, and TUI type checks passed.
Architecture checks passed 86/87; the unchanged documentation-length rule fails on
`docs/api-reference/core-routes.md` (211 lines) and `plugin-routes.md` (201 lines).

The rebuilt isolated desktop host used `/private/tmp/acorn-phase06-hosts-0God4B/desktop/repo`
and its local bare remote. Its snapshots showed 9 refs, creation of `phase06-desktop`, a manual
fetch success timestamp, direct comparison of 2 files and merge-base comparison of 1 file, local
identity readback from `.git/config`, the auto-fetch switch, and device display settings. The
fresh merge-base screenshot is in `.acorn/agent-dev/git-phase06/screenshots/screenshot-1791515946626.png`.
The rebuilt isolated TUI host used the sibling `tui/repo` fixture. At 120×40 it showed all 9 refs
and branch actions; at 80×24 keyboard scrolling revealed the selected ref and task/workflow
launches. TUI keyboard actions pinned `41852dc6` → `5c674821` in merge-base mode and displayed
base `b4046913` with `story.txt` in the detail. Earlier TUI snapshots in the same session showed
remote fetch success and Node and device settings. Both hosts were stopped after verification.

Payloads: Node startup 3,199,794/3,200,000 bytes; TUI startup 731,617/732,000 bytes. Desktop
renderer startup is 802,674/775,000 bytes, 83 bytes above the Phase 05 measurement of 802,591;
the cap is unchanged and the final branch gate must resolve the existing overage. Phase 07 may
build on the pinned comparison and scoped settings contracts. Phase 08 conflict resolution remains
deferred.
Depends on [phase 05](./05-task-and-workflow-launches.md).
Read the [full implementation context](./README.md), especially
[settings and refs](./README.md#refs-comparison-and-git-settings) and
[mutation contracts](./README.md#mutation-contracts).

## Deliverable

A person manages named refs and remotes, compares pinned revisions, configures Git behavior in
Acorn settings, and optionally enables Node-scheduled fetching. Checkout writes still require a
task, and remote actions retain Changes' hooks and semantics.

## Delivery units

Implement these units sequentially and verify each as a demoable slice before the next:

1. **Refs:** add branch/tag navigation and create/rename/delete/upstream actions. Recheck ref
   identity and reject task-reserved or checked-out branch mutation across project aliases. Offer
   task/workflow launch through phase 05; selection does not change a task branch.
2. **Remotes:** add remote navigation, add/remove/URL editing, and manual repository fetch. Validate
   URLs and names, disallow executable helper transports, retain explicit targets, and report
   network failures. Expose the Changes remote owner through a public contract where Git needs
   task pull/push, preserving before-push hooks and lease-based behavior.
3. **Comparison:** select two refs/commits, pin their IDs, and show direct or merge-base comparison
   with direction and base visible. Reuse topology, lazy diff, and bounded search from phase 02.
4. **Settings:** contribute scoped Git settings with effective identity/origin, explicit local or
   Node-global writes, fast-forward/rebase pull policy, and device graph/diff presentation. Use
   standard save/readback/dirty-form behavior; surface override and partial-write results.
5. **Auto-fetch:** default off and opt in at five minutes. Schedule on the Node, deduplicate
   aliased repositories, bound network work, prevent overlap, respect disabled/disposed plugin
   state, and expose last success/failure. A client read or mount must not fetch.

## Acceptance

- Real repositories cover checked-out/task-reserved branches, invalid names, annotated/lightweight
  tags, stale refs, aliases, direct/merge-base comparison, root histories, and merge parents.
- A local bare remote proves manual fetch, both pull strategies, push hooks, lease refusal when
  another actor advances the remote, and lease behavior after an auto-fetch updates tracking refs.
- Settings tests isolate a temporary HOME/config and prove effective origins, local versus
  Node-global writes, overridden values, readback, failure preservation, and Node switching.
- Scheduler tests prove off means no network calls, repository deduplication, cadence, no overlap,
  failures that do not stop other repositories, and disposal. Use an injected clock and controlled
  Git work rather than wall-clock sleeps.
- Both hosts demonstrate each delivery unit. Run [phase gates](./README.md#verification-strategy)
  for Git, Changes, settings/scheduler owners, public API, and affected clients.

## Verify before building

- Recheck settings scope/save contracts, Node schedule lifecycle, and Changes' remote contract.
- Confirm lease expectations under background fetching before exposing any force-with-lease action.
