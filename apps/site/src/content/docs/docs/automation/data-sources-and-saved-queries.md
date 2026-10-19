---
title: Data sources and saved queries
description: The typed sources dashboards and workflows read from, which account and projects a read reaches, the workspace's saved queries, and sources built from other sources.
sources:
  - docs/data-sources.md
  - docs/data-sources/query-library.md
  - docs/data-sources/derived-sources.md
  - docs/data-sources/provider-sources.md
  - packages/client-core/src/features/dataSources/SourceQueryEditor.tsx
checked: 'd853aa822'
---

A data source is a set of records a plugin can read, each with the same known fields: GitHub pull
requests, Linear issues, Rollbar errors, acorn's own tasks, agent sessions, or what each agent turn and
session spent. Dashboards and workflows' **Find records** steps read every record through sources.
This page covers what a source is, which account and projects a read reaches, saved queries, and
sources built from other sources.

## What a typed source is

Each source describes its fields and their types: text, a number, a date, a person, or one of a fixed
set of values such as a pull request's state. Because acorn knows the type, the editors offer only the
comparisons and values that make sense, and a workflow step after **Find records** reads fields, not
text.

Where you meet sources:

- **A dashboard panel**, through **Start from data** or the panel editor's **Data** section
  ([Dashboards](/docs/automation/dashboards/)).
- **A workflow's Find records step**, through its **Source or saved query** field
  ([Steps, gates, and budgets](/docs/automation/steps-gates-and-budgets/#the-step-kinds)).

A read says whether it's complete. A source that answered in part, or ran out of records it may read
at once, says so, and the panel or step shows it as partial rather than as a full answer.

## Which account and which projects

A source that reads a service, such as GitHub, reads it with one account you choose, under **Account**.
acorn never picks an account for you. A plugin's source gets only that account's access, and agents in
a task get none of it.

**Reach** says which of the workspace's links a read covers, such as the GitHub repositories of the
workspace's projects: all of them, or the ones you pick. A read never covers a whole account.

## Saved queries

A saved query is a query the workspace keeps for reuse, by dashboards, workflows, and schedules. It
belongs to a workspace, and can be limited to one project. It has a draft you edit and a published
version that's used, so editing it changes nothing until you publish.

Pick one from **Source or saved query** in place of a source. It's marked **Shared query**, with:

- **Edit saved query**, which edits the saved query itself, for everything that uses it. The line under
  it says what does, such as **Used by Open pull requests, Nightly triage**.
- **Customize for this use**, which copies it into this panel or step, to change here only.

A published saved query reaches every panel that uses it at the panel's next refresh. A workflow fixes
the version when its run starts. acorn won't delete a saved query that something still uses.

If the saved query changed somewhere else while you edited it, acorn says **This saved query changed
elsewhere**, keeps your edits on this device, and offers **Reload changed query** or **Customize for
this use**.

## Sources built from other sources

Some plugins offer a source that reads other sources and combines them, such as release readiness from
Linear issues and GitHub pull requests. acorn reads the inputs for the plugin, with the accounts you
choose, and the plugin never sees those accounts' credentials.

1. Pick the source in **Start from data**. It's listed once, with what it reads.
2. Choose an account for each input. An input that's optional offers **Skip**. With no account for an
   input's service, acorn offers to connect one.

The panel's starter panels and **Blank panel** wait until every required input has an account. An
installed plugin must have your approval to read its inputs, and asks again if it wants more.

## Datasets

A dataset is a copy of a source's records that the Node keeps, captured on a schedule, so a panel can
show history the service doesn't keep. Make one with **Keep history** in the panel editor
([Dashboards](/docs/automation/dashboards/#keep-a-history)). A dataset is a source too, listed with the
others.

## Limits

- The app picks and edits saved queries, and has no button that makes a new one.
- A source whose plugin is off, or whose account is gone, is unavailable. acorn never treats it as
  empty.
- The agent sessions source reads at most 5,000 sessions, and says it's partial past that.
- The agent usage records, turns, and session totals sources read the newest 5,000 records in a
  panel's time window, and say they're partial when the window holds more.
