---
name: antislop-codebase
description: Analyze and transform messy, prototype, overgrown, slop-prone, or hard-to-maintain software repositories into maintainable product-shaped codebases while preserving existing product behavior. Use when the user asks to antislop a codebase, clean up a messy repo, run a maintainability migration, write a refactor plan, modernize structure, improve TypeScript/type boundaries, harden tests, reduce large files, clean architecture, coordinate subagent-driven refactors, or produce a final migration audit/report/microsite. Do not use for broader production-readiness specialties such as security audits, observability/logging programs, compliance hardening, SRE/runbook work, or reliability engineering unless the user explicitly scopes those as part of the maintainability refactor.
---

# Antislop Codebase

Use this skill to move a repo from "works but hurts" to a product-shaped cluster of small, typed, tested, maintainable modules while keeping the current product essentially as-is. Treat this as the first maintainability/productization pass, not the broader production-readiness program.

## Boundary

This skill is for structural maintainability: code organization, typed boundaries, tests, feature folders, API consolidation, file-size reduction, styling cleanup, and audit evidence.

Do not expand the scope into a full production-readiness initiative. Observability/logging programs, security reviews, compliance, incident response, SLOs, runbooks, secrets posture, penetration testing, and deep reliability engineering belong in separate follow-on skills unless the user explicitly asks to include a small enabling change.

## Operating Principles

- Preserve behavior first. Improve architecture in thin, reversible slices.
- Ground every decision in repo facts: file sizes, dependency graph, tests, runtime shape, API surfaces, user workflows, deployment limits, and current dirty worktree.
- Keep files AI-editable: prefer focused modules under roughly 300-500 lines, explicit feature folders, stable compatibility barrels, and narrow tests.
- Never rewrite active user-owned areas without permission. If other agents/users are editing a surface, audit or work around it.
- Use concurrent subagents for independent analysis or isolated edit slices when available, but merge with one owner who validates the whole tree.
- Commit at green checkpoints. Do not let a migration become a giant unreviewable diff.
- End with evidence: a migration audit microsite served locally, with visuals, metrics, risks, and before/after interpretation.

## Workflow

### 1. Establish The Product Shape

Run a quick non-mutating discovery pass before planning:

- Find package scripts, app entrypoints, API routes, deployment config, test harnesses, type config, and current git status.
- Measure largest files and top directories.
- Identify user-critical workflows, deployment constraints, data persistence, auth, provider integrations, and expensive operations only insofar as they affect safe refactoring.
- Read recent commits and docs to avoid undoing active work.

If the repo is live or user-facing, default to compatibility-preserving migrations and rollback paths.

For deeper discovery prompts and commands, see [analysis-checklist.md](references/analysis-checklist.md).

### 2. Write A Decision-Complete Migration Plan

Produce a plan that can evolve, but is complete enough for another agent to execute:

- Goal, success criteria, explicit non-goals, active no-touch areas, and risk posture.
- Staged slices ordered by blast radius and verification confidence.
- Public interfaces and compatibility promises.
- Test plan: current baseline, new tests needed, e2e/visual checks, deploy smokes.
- Concurrency map: which workers can edit independently and which files are single-owner.
- Checkpoint policy: when to commit, push, deploy, and audit.

Use `request_user_input` only for product tradeoffs that cannot be discovered from the repo.

### 3. Build The Baseline Safety Net

Before broad edits:

- Run existing typecheck, unit tests, build, and e2e if practical.
- If tests are missing, add or plan the smallest high-value characterization tests before refactoring behavior.
- Add only minimal diagnostics or recoverable error handling needed to make the refactor safe; defer comprehensive logging/observability programs to a separate production-readiness skill.
- Capture screenshots for core UX surfaces; for browser e2e, visually inspect mobile, desktop, tablet, and ultrawide output when practical.

### 4. Execute In Green Slices

Process the migration methodically:

- Split largest and hottest files first, preserving old import surfaces through barrels/facades.
- Extract pure models/helpers before UI shells.
- Convert untyped or ad hoc boundaries to shared domain types and runtime validation where API/provider data crosses a trust boundary.
- Consolidate duplicated server/API functions only after response shapes are pinned by tests.
- Migrate styling surface-by-surface; remove legacy selectors only after screenshot checks.
- Keep each slice small enough to test, review, and revert.

Use up to the user-approved subagent concurrency. Assign workers to independent surfaces such as tests, CSS, server helpers, frontend feature extraction, type boundaries, and audit tooling. Do not let subagents edit the same hot files concurrently.

For execution rules and worker prompts, see [execution-playbook.md](references/execution-playbook.md).

### 5. Validate, Commit, Deploy

At each checkpoint:

- Run the narrow tests for the touched surface.
- Run broader typecheck/build/unit tests before committing.
- Run e2e/visual smoke before deploy when UI or production flows changed.
- Commit only the intended files; preserve unrelated dirty user work.
- Deploy only when the agreed release gate is green, or explicitly mark a known-risk release.

### 6. Finish With A Migration Audit Microsite

When the migration is stable, generate a static HTML audit microsite that answers:

- Did maintainability improve?
- How many LOC/files were added/removed?
- Which file sizes collapsed?
- How did the structure evolve?
- What changed in tests, types, API functions, deployment risk, and UX coverage?
- What costs and risks remain?

Serve the microsite locally and return a clickable `localhost` or `127.0.0.1` URL. The user prefers opening microsite artifacts inside Codex rather than receiving only a file path.

Use [audit-microsite.md](references/audit-microsite.md) for metrics, structure, and validation.

## Quality Bar

A successful antislop migration has:

- No giant ownership-free files in hot paths.
- Clear feature/provider/domain folders.
- Typed module boundaries for frontend/backend/API/provider data.
- Tests that carry their weight and can be run narrowly.
- Production-shaped local/dev deploy checks.
- A final audit artifact that is honest about wins, costs, and residual risks.
