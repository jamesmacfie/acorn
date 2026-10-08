# Phase 08: explain dependency and install-policy changes

## Completion note: October 9, 2026

Status: implemented as an advisory Changes review. The Node compares HEAD with the index for staged
review and the index with bounded disk reads for unstaged review. Relevant untracked files join the
unstaged side. Reports carry a task-bound digest of both inputs, scope, format, and analyzer version.
The Changes list refreshes the report with its status, hides the previous result while a replacement
loads, and links findings to files in the selected scope. Stage, diff, commit, and push paths retain
their established behavior.

The analyzer supports npm lockfile versions 2 and 3, npm shrinkwrap, pnpm lockfile version 9,
manifests, workspace settings, and repository registry configuration. It reports manifest requests,
lockfile importer resolutions, peer variants, aliases, optional and workspace identity, source and
integrity changes, project lifecycle-script names, manager versions, and policy edits. It treats
catalog and override specifier differences as expected resolution behavior. Missing, malformed,
oversized, mixed, and unsupported inputs produce partial or unsupported coverage. It does not run
package managers, JavaScript configuration, project scripts, or hooks. Executable configuration is
labelled uninterpreted. There is no network metadata action: registry destination and redirect
policy cannot be verified safely from repository files alone. Installed dependency scripts, release
dates, publisher identity, provenance, and malware status remain unknown. Integrity never implies
provenance.

Changes publishes `STATIC_DEPENDENCY_POLICY` through the protocol contract for Phase 07. The
diagnostic calls this read-only, lazy capability for a selected project's canonical root, and keeps
its previous fixed-file summary when Changes is unavailable. Later phases can consume the typed
facts without importing Changes implementation or causing executable work. No approval gate or
terminal-install enforcement was added.

Evidence: the Changes suite passed 278 tests with one skipped; the client-core suite passed 2,599;
focused dependency review passed six, and Phase 07 diagnostics passed 13. Architecture tests passed
87. TypeScript checks passed for Changes, agents, protocol, Node, client-core, and desktop. The Node
service built at 3,190,861 B with a measured 3 KB ceiling increase for route and capability wiring;
`dependencyReview.ts` and YAML remain outside its static graph. The desktop renderer build passed.
The isolated desktop displayed staged and unstaged lockfile/manifest selections. An edit while the
unstaged report was open changed its count from one to two after refresh, and restoring the file
returned it to one. The fixture was stopped. The route golden passed 35 of 36 checks; its sole
failure is the pre-existing GitHub pulls search entry. The full agents suite had three unrelated
sandbox-sensitive process/worktree failures; its changed diagnostic tests passed. No private-registry
metadata fetch was attempted.

Date: October 8, 2026. Status: proposed product requirements; implementation not started.
Source baseline: `079f5c948161ea8213bcdb25fe2fbefccab7d6f1`.
Dependency: none of phases 01 to 07; share static policy facts with phase 07 when available.

This phase adds a dependency review to Changes. Give it to the developer owning repository changes
and package metadata. It turns manifest, lockfile, and install-policy edits into a readable explanation.

## Problem and outcome

Release-age limits reduce exposure to fresh malicious versions. They do not identify an established
malicious package, a dependency source swap, an added install script, or an exception that weakens
the policy. A lockfile diff can bury those changes among hundreds of unrelated entries.

The outcome is a review of the exact staged or unstaged revision the owner selected. It explains
direct and transitive changes, source and integrity changes, executable scripts, and effective policy.
Analysis does not install dependencies or change how developers run their package managers.

## Starting points and owners

Read these owners and their tests:

- `plugins/changes/src/server/localDocument.ts`, `plugins/changes/src/server/localDiff.ts`, and
  `plugins/changes/src/server/gitPaths.ts` own revisions, diff reads, and repository path validation.
- `plugins/changes/src/server/localGit.ts` declares commit and push hooks.
- `plugins/changes/src/shared/api.ts` owns Changes wire contracts.
- `packages/node-core/src/server/core/fs.ts` owns symlink-aware path confinement.
- `pnpm-workspace.yaml` declares Acorn's release-age limit, build approvals, overrides, and catalog.
- `scripts/pack-node.mjs` resolves and includes the standalone npm lockfile.
- `tools/arch/dependencySecurity.test.ts` checks Acorn's dependency security conventions.

Read [the Changes pane](../../diff-rendering/changes-pane.md), [path controls](../../security/process-and-paths.md), and
[plugin supply chain](../../security/plugin-storage-and-supply-chain.md).

## Required behaviour

Support pnpm and npm in the first release. Recognize package manifests, pnpm lockfiles and workspace
settings, npm lockfiles and shrinkwrap files, and repository package-manager configuration. Detect
workspace package roots and the package manager version. Unsupported lockfile versions, mixed managers,
Yarn, Bun, and Python report partial or unsupported coverage, with the ordinary diff still usable.

For a selected staged or unstaged change, report:

- Added, removed, and changed direct dependencies, separated from transitive changes.
- Version and source changes, including registry origins, Git revisions, local paths, and tarball URLs.
- Added, removed, or changed integrity fields and lockfile entries without integrity metadata.
- Lifecycle scripts added to project manifests, and installed dependency scripts only when matching
  package bytes are already available and verified against the reviewed resolution.
- Release-age changes and exceptions, script/build approvals, trust or source policy changes, registry
  overrides, and changes to package-manager executable versions.

Do not execute JavaScript config to learn policy. Decode data formats with bounded parsers and label
config you cannot interpret. Preserve resolution identity, including peer variants, aliases, optional
packages, workspace links, overrides, and catalogs. Count meaningful package changes without treating
peer-context variants as unrelated package names.

Reading a lockfile alone cannot establish dependency scripts, maintainer identity, release dates,
provenance, or malware status. Mark these unknown unless supported by additional evidence. An explicit
**Fetch package metadata** action may request data from the project's allowed registry through a
bounded metadata client. Validate destinations, redact registry credentials, handle redirects and
private registries deliberately, and send package coordinates only. No source upload or model call.
Network failure leaves local analysis available and external facts unknown.

Show release age as a warning, not a verdict that age proves safety. Distinguish registry integrity
from verified provenance. A hash confirms fetched bytes match the registry claim, not publisher intent.

## Data flow and presentation

Changes resolves task to canonical root, reads immutable Git blobs or bounded disk files for the chosen
scope, normalizes package records, compares them, and returns a typed report. Key it by task, scope,
content digests, package-manager format, and analyzer version. Staged analysis compares HEAD to the
index; unstaged analysis compares index to disk and includes relevant untracked manifests and locks.

Do not read only disk when the owner is reviewing staged content. Mark the report stale after a stage,
unstage, edit, reset, or checkout. Before any configured approval is consumed, recheck its digest.
Reconcile a manifest change with its lockfile and flag missing or inconsistent resolution evidence.

Draw a compact dependency summary beside Changes' ordinary file review. Link each finding to the
relevant file and scope. Keep long lockfile details on demand. Reuse shared UI components and existing
cache invalidation. Do not replace the diff or copy repository contents into core preferences.

This release is advisory. It does not block arbitrary shell installs or require approval for every
dependency edit. A later enforcement mode needs its own execution-boundary design. Do not claim the
Changes hooks cover direct terminal Git or an agent's package-manager invocation.

## Implementation sequence

1. Define normalized resolution records and high-value npm and pnpm fixtures.
2. Add pure format adapters and bounded Git/disk snapshot reads beside Changes.
3. Implement policy and resolution comparison with explicit partial outcomes.
4. Add typed report routes and revision-bound UI, then optional metadata fetching.
5. Publish a narrow static-policy capability for phase 07 if its collector needs the same facts.

Check installed dependencies before adding parsers or scanners. Use a mature data parser where it
reduces format risk, but weigh payload and maintenance. Avoid implementing a package resolver.

## Acceptance and verification

Prove these behaviours:

- npm and pnpm fixtures distinguish direct, transitive, alias, peer, optional, and workspace changes.
- A registry-to-Git source swap and a removed integrity field remain visible amid a large lockfile edit.
- A release-age exception or expanded build approval is identified at its config file.
- A staged safe manifest with a different disk manifest reports staged bytes until the scope changes.
- Missing, malformed, oversized, or unsupported lockfiles return partial or incomplete results.
- Unknown dependency scripts and provenance stay unknown instead of inheriting unrelated cached metadata.
- Static analysis launches no package manager, project script, hook, or configured executable.
- Optional metadata fetching handles failure and private registries without exposing credentials.
- A symlink outside the worktree is refused through the established filesystem policy.
- Ordinary stage, commit, push, and diff flows retain their behaviour.

Run `pnpm lint`, `pnpm test --filter=@acorn/plugin-changes --filter=@acorn/client-core`, any changed core and
protocol suites and consumers, and `pnpm --filter @acorn/arch-tests test`. Exercise both review scopes
in the real desktop app, including an edit while the report is open. Stop the driver session afterward.
Update `docs/diff-rendering/changes-pane.md` and `docs/security.md` with coverage and limits.

## Trade-offs

Format support is the main maintenance cost. Ship two explicit adapters with partial results instead
of claiming universal support. Chat on Steroids' pinned MCP installation and Acorn's own
`allowBuilds` policy demonstrate useful review inputs; neither replaces analysis of a project's graph.
