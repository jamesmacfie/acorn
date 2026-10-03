# Delivery and acceptance

Date: 2026-09-27. Status: proposed implementation order and open gates.

The work closes only when a person can use `acorn` from an empty terminal profile through setup,
task work, review, and recovery without the desktop. Each phase leaves the TUI buildable and has a
visible result. Keep behavior in the owning feature and project text into cells at the host boundary.

## Phase 1: establish a truthful terminal contract

1. Finish the icon sweep. Audit all `Icon` and `IconButton` call sites for state that lost its only
   label. Keep semantic text beside status, selection, and destructive actions. Inspect 80 by 24
   screens after each affected pane change.
2. Gate every action on the capability it uses. Replace missing file and dialog seams with typed path
   flows or hide their controls. Make an unavailable operation show a reason before Enter, not after
   a silent no-op.
3. Repair startup recovery. Re-fetch queries that failed while the Node was booting, reset failed
   pane boundaries after the refetch, and provide a Retry control for a persistent error.
4. Give selected rows a full identity and put large action sets into an Actions list. Prioritize
   Changes, GitHub, agent sessions, and Docker, where the live fixture clips names and verbs.

Acceptance: a repository search finds no Lucide name-to-glyph TUI mapping, no visible terminal
control calls a missing platform seam without feedback, and the selected object's full name is
readable at 80 by 24. A reused fixture must recover its Agent pane after a transient refused
connection. The icon and startup dependency repairs made during this review are the first part of
this phase, not its completion.

## Phase 2: make terminal-only setup possible

1. Add a first-run screen for an empty profile. It creates or selects a workspace, adds a project,
   identifies the local Node, and offers agent/provider setup without requiring it.
2. Add a Settings command group and terminal pages for the settings needed by the feature inventory.
   Use existing Node and device config APIs; expose editable paths where the desktop uses pickers.
   The route and its listing shipped on 2026-09-30 ([tui.md](../../tui/sources-and-settings.md#settings)); the terminal
   forms for the pages it lists as **desktop app** remain.
3. Add clear help for absent external integrations, offline Nodes, and missing CLIs. Return to setup
   from the palette after onboarding.

Acceptance: a fresh `ACORN_DATA_DIR` and `ACORN_TUI_CONFIG_DIR` can reach a usable task, configure a
provider or installed CLI, and recover from a failed setup using only the terminal. Search for
`settings` and `new task` returns an actionable route.

## Phase 3: complete the working journeys

1. Provide a terminal-native raw session surface and a safe managed-agent handoff. Keep the session
   list, PTY, resume, and return to managed mode reachable from a task and the palette.
2. Add typed path or byte-stream alternatives for agent attachments, artifacts, and transcript
   export. Add a terminal task picker for source-item promotion.
3. Complete the feature journeys in [the inventory](./features.md), including real writes against
   disposable Git, HTTP, and database fixtures and real agent CLIs where installed.

Acceptance: each applicable feature has a recorded keyboard journey through action, result, and
error recovery. Desktop-only capabilities have a visible explanation and no dead controls.

## Phase 4: prove the app at terminal sizes and package boundaries

1. Run `pnpm lint`, relevant package tests, `pnpm test`, and the architecture and documentation path
   checks. Verify a fresh install resolves every external module in the TUI bundle, including `pg`.
2. Run `pnpm dev:tui:agent -- --session NAME --fixture tui-navigation`, then the navigation flow and
   targeted live paths. Inspect snapshots after each transition at 80 by 24 and 120 by 40. Repeat
   critical keyboard actions with `--keyboard legacy` and resize while a PTY is entered.
3. Run the same seed in the desktop agent window and compare task counts, pane content, action
   results, and error states. Host layout may differ; lost data or unreachable operations fail.
4. Test a clean profile, local attach, remote pairing, missing provider, revoked Node, plugin trust
   and update, and a long task with many files and turns. Run packaged artifacts, not only checkout
   builds, before release.

Acceptance: no startup error, uncaught pane failure, clipped primary label, unreachable control,
silent no-op, or focus trap appears in the recorded journeys. Every exception is an intentional host
limit with a clear alternative or explanation. Save a dated report with commands, environment,
screens, failed and passed criteria, and open risks.

## Definition of done

- The [feature inventory](./features.md) has a passing outcome or a justified host limit for every
  row. An unverified code path cannot be marked complete.
- The full terminal-only setup and daily-work journey succeeds in a real PTY at both sizes.
- The keyboard help names the current place and accurately describes keys the user's terminal sends.
- The app provides text for every action and state formerly conveyed only by an icon.
- The owning docs under `docs/` describe shipped behavior. This folder retains the dated evidence
  and decisions until the acceptance report closes.

## Verify before building

- Check this order against the current dependency graph and feature registrations.
- Confirm the fixture uses isolated data and ports; do not run destructive feature writes against a
  developer's real Node or repository.
- Treat a green unit suite as necessary but insufficient. Inspect the real cell frames and action
  results before claiming terminal UX acceptance.
