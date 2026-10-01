# Performance implementation contract

This contract applies after the coordinator finishes all area investigations, reviews dependencies,
and assigns a concrete implementation unit. It does not authorize application changes during audit.
The user already authorized fixes and verification. No additional approval is needed for ordinary
reversible implementation, documentation and isolated testing within that scope.

## Work ownership

One implementation specialist runs at a time. Do not start subagents or create branches or commits.
Read the assigned reports, the consolidated plan, applicable AGENTS instructions, docs index,
architecture, conventions, and the owning documentation before editing. Apply the maintainability
guardrails skill and the readable skill to relevant deliverables. Prefix shell commands with `rtk`.

Trace the changed owner from source to consumer. Preserve runtime, plugin, capability, contribution,
Node isolation, auth, custody, portability and persisted-state boundaries. Respect the latest worktree
as the cumulative result of earlier units. Never overwrite another completed fix or restore a file
from baseline wholesale. Report a dependency conflict to the coordinator and continue unaffected
work. Future proposals are context; they do not authorize implementing unshipped architecture.

Keep code small, typed and feature-owned. Composition stays thin. Lifecycle and concurrency fixes
must own their resources explicitly, settle completion paths, and avoid changing another owner's
work. A shared observer dropping out must not cancel a live observer. Delayed reads and writes must
remain bound to their originating Node and generation. Disposal is idempotent and preserves durable
work, unsent drafts and required cleanup writes.

## Evidence and tests

Preserve all baseline artifacts. Run assigned probes with a distinct `after` tag and invoke the new
production owner. Adapt fail-before assertions to intended behavior, retaining the original result
files and making the assertion change explicit. Do not benchmark an obsolete library import after
production adopts a new owner.

For browser/Solid probes, verify a single reactive runtime and a correctly owned QueryClient before
accepting the baseline. Unit 05 found that an audit alias of `@tanstack/solid-query` to its package
directory selected the CommonJS entry and a second Solid runtime. Prefer the explicit installed ESM
entry or verified package export resolution; ordinary provider composition and actual component
construction must remain reactive. Record probe/config hashes and component construction counts
through update phases. Preserve old artifacts and label superseded evidence; never compare a dead
or multiply constructed before tree with a working after tree. Existing configs in areas 03, 08,
10, and 16 also use that directory alias and need checking in their assigned implementation units.
This does not invalidate independent pure, process, or transport evidence by itself.

Add lasting tests beside the owning code when needed to verify real behavior: races, cancellation,
errors, stale completion, disposal, recovery, migration, bounds and supported host compatibility.
Avoid implementation-mirroring tests or optional broad test expansion once a concrete risk is
resolved. Run relevant focused suites and type/lint checks for the unit. The coordinator runs the
final whole-repository `pnpm lint` and bounded `pnpm test`; never use direct `turbo run test`.

Compare the same workload before and after. Separate operation count, allocation size, retained
heap, process CPU, elapsed time and native UI latency. State when workers/processes are fixtures,
DOM is jsdom, the build is development, or the window is hidden. Count reduction can establish
removed work without claiming visible latency. Do not turn estimates into measured improvements.

## Live verification

Coordinate builds, asset staging, heavy measurements and live changes with the coordinator. The
baseline Tauri window uses already-staged artifacts; it cannot verify newly edited source. Stop it
before staging replacements and launch a fresh isolated session for final native checks. Never
inspect or alter normal profiles or expose credentials. Use disposable synthetic records, terminals,
repositories and processes. No paid provider work or external messages.

When a change affects desktop UI, use the documented real Tauri driver workflow: fresh snapshot
after transitions, click/fill/screenshot, visually review relevant screenshots, and stop the test
session. Visible timing requires a visible, focused renderer; a hidden run supports functional and
resource checks only. Process ownership probes must clean up every synthetic child they create.

## Handoff

Return changed files and why the owner is correct, exact focused verification commands/results,
before/after evidence paths and comparisons, documentation updates, remaining concrete risks, and
any intentionally deferred finding. Write the implementation record under `plans/performance/`.
Application behavior or contract changes must update their owning docs. No new source or report
page belongs in `docs/` without the docs index entry and link validation.

Do not claim the entire performance task is complete. The coordinator reviews your diff, resolves
remaining gates, continues the sequential units, and performs the sustained-use and final checks.
