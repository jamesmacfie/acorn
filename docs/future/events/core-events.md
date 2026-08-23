# Core events: the catalogue

Part of [docs/future/events/](./README.md). These are the events core itself emits, because core is
the only honest observer of the underlying transition. Everything here assumes
[delivery.md](./delivery.md) is done; every entry names its node-side emit points because the survey
found them, and most are single choke points the code already funnels through.

Ordered by leverage.

## HEAD moved

`{ projectId, taskId?, branch, head, dirty }`, when a commit lands, a branch is checked out, or a
pull or rebase moves the tip.

The highest-leverage event in this folder by a wide margin. It converts a whole class of plugin from
blind polling to reactive: continuous integration, preview deployments, coverage diff, bundle size,
changesets, lockfile watching, secret scanning. Every one of those has to guess today, and the
300-second plugin cadence floor means it guesses slowly. Given a choice between lowering that floor
and adding this event, add the event: a plugin that fetches once on a real signal costs less than
one polling every five minutes forever.

**Nothing in the tree observes HEAD today.** The survey confirmed it from both ends:

- The changes plugin never reads a SHA. Its only `HEAD` literals are a push refspec and a blob
  default ref (`plugins/changes/src/main/localDiff.ts:172,197`).
- Core's only periodic git read is `computeTaskStatuses`
  (`node-core/src/main/taskWorktree.ts:125-129`), and it returns dirty state only — no branch, no
  head SHA — so a commit that leaves the tree clean is indistinguishable from no change at all.

So the implementation has two halves, and both are needed. The in-app half is nearly free: every
local-git mutation already funnels through one wrapper (`plugins/changes/src/main/localGit.ts:18`),
so commit (`:50`) and push (`:54`) are one emit away. The out-of-app half — a terminal PTY, an agent
session, or an outside editor moving HEAD — has no hook to catch, which is what makes extending
`computeTaskStatuses` with branch and head SHA the smallest honest implementation: the poll already
runs, it just does not carry enough to notice.

## Task changed

`{ taskId }`, deliberately payload-free, so a dropped frame self-heals by re-reading.

Less an addition than finishing what is half-built. It closes the stale-list defect
([delivery.md](./delivery.md) defect 1), and it serves the standup assistant, worklog push, and any
source plugin showing a task list. Emit points: the CRUD surface in `server/routes/tasks.ts` (which
broadcasts nothing today), task insert and cancel in `main/core/tasks/service.ts:204,209`, the
guarded archive path in `main/archive.ts`, and branch-to-PR adoption
(`plugins/github/src/server/routes/pullRefresh.ts:131` calls `core.tasks.adoptPullNumbers`, so the
emit belongs in the core seam, not in github).

The cheapest item here, and it removes a defect rather than adding surface. Ship it first.

## Worktree created and removed

`{ taskId, projectId }`, for the service-dependency runner, port manager, and tunnel manager.

The original proposal said "try folding this into task changed first", and that remains the right
first question — a worktree appearing is a task state transition. What the survey adds is that both
choke points are exact and both are silent today: creation fires the `WORKTREE_CREATED` hook in
`node-core/src/main/taskWorktree.ts:222-224` (single-slot, held by terminal to run setup), and
removal happens in `main/archive.ts:108-118` with no broadcast at all. If task changed turns out to
carry enough (a consumer can re-read `worktreePath`), fold it; if consumers need the transition
itself rather than the state, these are the two lines.

## Run target state

`{ taskId, targetId, running }`, when a declared dev process starts, stops, or exits.

New since the original proposal, and the survey makes the case: start and stop are two exact points
in terminal's `main/runtime.ts:87,101`, and the standing consumer is already contorted around the
absence — preview re-derives its URL through a resource keyed on
``targets().map(t => `${t.id}:${t.running}`)`` (`PreviewTaskPane.tsx:19`), a poll wearing a signal's
clothes. A port manager, tunnel manager, or dependency runner wants the same fact. This is state a
plugin cannot observe from outside (test 1), per process-start rather than per tick (test 2), and
the sentence writes itself. Note the boundary: the *declared run targets* changing state is an
event; generic process and port lifecycle stays refused ([refused.md](./refused.md)).

## Focus changed

`{ taskId: string | null, paneId: string | null }`, coarse.

Unchanged from the original proposal. Not only for time tracking: every plugin whose job is to show
the thing relevant to what you are looking at needs it — offline documentation, Storybook for the
current component, the Figma frame for this ticket. The compiled-in tier already has this through
the `activeTaskId` signal; this event exists to carry it across the frame boundary, not to duplicate
it. The one warning worth repeating: `ctx.core.tasks.active()` means `status = 'active'`, not "the
task the person is looking at" — this event is the only place the latter will exist outside the
shell.

## Agent session state

`{ taskId, sessionId, state: 'started' | 'finished' | 'failed' }`.

Agent execution is the most distinctive thing acorn does and third parties are completely blind to
it: the `agent` WS prefix is claimed by the agents plugin, and `ctx.events.channel` is
`undefined as never` for loaded plugins. That blocks cost dashboards, run history, notification and
focus plugins, and any timekeeping that counts waiting on an agent as work.

The survey found both the emit points and the precedent. Every managed-agent event already funnels
through one `emit()` in `plugins/agents/src/main/runtimeEngine.ts:437-443`; the honest transitions
are provider start (`:232`), turn completed or errored (`:265-268`), and the failure edges
(`:236-248` and `:294`). And the reduction from firehose to event already exists in production: the
agents webhook service (`main/webhookService.ts:249-253`) filters the same stream down to
`completion` and `attention` for external delivery. This event is that filter pointed inward. Do not
invent a third vocabulary; the webhook one is deployed and has consumers.

Two adjacent facts, recorded so they do not get lost: terminal-tier agent PTYs have their own end
edge (`plugins/terminal/src/main/terminal.ts:294` already special-cases it to trigger memory), and
browser-tool sessions have a per-task lifecycle in `plugins/browser/src/server/driver.ts:108,181`.
Whether those fold into this event or stay plugin-local is a payload question to settle when this
ships; the managed-agent case is the one with blocked consumers today.

## Connection changed

`{ integrationId, providerId, status }`, on create, rotate, test, disable, revoke, and — the one
that matters — demotion to `needs-auth`.

Promoted from "lower confidence" in the original proposal to a firm entry, because the survey found
the transition has **four independent writers and zero announcements**:
`server/integrations/connections.ts` (create `:87`, rotate `:132`, test `:177`, disable `:203`,
revoke `:212`, sweep demotion `:239`), `resourceRuntime.ts:84-87`, `projectSource.ts:94`, and
`modelProviders/runtime.ts:80-85`. Every consumer copes by refetching on suspicion or discovering
revocation through a 401 mid-request. An integration plugin that stops hammering a revoked
credential is the cheap win; a settings page that updates while you watch the device flow complete
is the visible one.

## Project changed

`{ projectId }`, payload-free like task changed.

New, and earned the same way task changed did: the write surface is real and entirely silent. Rows
are created, patched, re-detected, and deleted in `node-core/src/main/projects.ts`, and — the
sharper half — `projectConfig.ts:60` writes setup/teardown/dev scripts, the database schema hint,
preview mode, browser rules, and the branch prefix, all of which other plugins consume (preview
reads `browserRules` and `previewMode`, terminal reads run targets, changes reads the branch
prefix). Nothing broadcasts; onboarding hand-invalidates its own query cache after creating a
project (`OnboardingWizard.tsx:82-83`), which is the workaround this deletes. Repo config writes are
already recorded as a code-execution surface, so a config change is also a fact a security-minded
plugin legitimately wants to hear.
