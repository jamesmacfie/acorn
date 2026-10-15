---
title: Schedules
description: Work a Node runs on a timer, from acorn, plugins, and you. How often it may run, the risk you accept once, and each schedule's history.
sources:
  - docs/schedules.md
  - docs/schedules/plugin-schedules.md
  - docs/schedules/user-schedules.md
  - packages/client-core/src/features/settings/SchedulesSettings.tsx
checked: 07aa959a0
---

A schedule is work a Node runs on a timer, whether or not any client is open. acorn runs some of its own
upkeep this way, plugins can add schedules, and you can add your own. This page covers all three, and
where to see and control them.

## See every schedule

Open **Settings** > **Automation** > **Schedules**. With more than one Node, pick the Node in the header,
because each Node runs its own schedules.

Each row names its owner, says how often it runs, when it last ran and how that went, and when it runs
next. On each row:

- The switch pauses or resumes that schedule. A paused schedule keeps its settings.
- **Run now** runs it straight away, even while paused.
- **History** lists its last 20 runs.
- **Delete schedule** removes one of yours. What it already made stays.

**Pause every schedule on this node** stops them all until you turn it off.

## acorn's and plugins' schedules

acorn keeps itself tidy on a schedule, such as removing audit log entries older than 90 days, each
night. Plugins add their own. For example, the Agents plugin can refresh plan usage every 30 minutes,
and that one is off until you turn it on.

A plugin's schedule can run at most every 5 minutes, and a plugin can have at most four. When you
install a plugin, its schedules are listed under **Declared** in the trust dialog, because they run
with no window open. An update that changes one asks again. Turning a plugin off stops its schedules
and keeps their history, and turning it back on picks up where they were, paused or not.

## Add your own schedule

You can schedule actions that plugins offer to run on a timer.

1. In **Settings** > **Automation** > **Schedules**, under **New schedule**, pick the **Action**.

   acorn says what it does on this Node, such as **changes data on this node**, and that it runs on its
   own and never asks again.

2. Give it a **Name**, and pick **When**: **Every hour**, **Every day at 09:00**, or **Every Monday at
   09:00**.
3. Click **Accept and schedule**.

The risk you accept is stored with the schedule. If an update to the plugin makes the action riskier,
the schedule stops running and says **You agreed to** the old risk, with **Accept the new tier** to
start it again. If the action goes away, because its plugin is off or removed, runs are skipped until
it comes back.

To run a workflow on a schedule, use **Schedule…** in the workflow's editor ([Start and schedule
runs](/docs/automation/start-and-schedule-runs/#run-a-workflow-on-a-schedule)).

## When a schedule runs

- **How often.** A schedule runs every so many seconds, each day at a time, or each week on a day at a
  time, in the Node's time. A plugin's runs every 5 minutes at most, and none runs less often than
  once a week.
- **Missed runs.** If the Node was off or asleep when a schedule was due, it runs once when it can, not
  once for each time it missed.
- **One at a time.** A schedule still running when it's due again skips that turn. At most four
  schedules run at once on a Node.
- **Time limit.** A run gets 60 seconds unless its owner says otherwise, and 5 minutes at most.
- **Failures.** After a failure, a schedule waits longer before trying again, doubling each time up to
  6 hours. Its row says when it will try next.

## In the terminal

**Settings** > **Automation** > **Schedules** opens in the desktop app. The terminal client doesn't
draw it.

## Limits

- There's no cron syntax. Schedules use the three kinds of timing above.
- A schedule runs only while its Node is running.
- You can't change what a plugin's schedule does or how often it runs, only pause it or run it now.
