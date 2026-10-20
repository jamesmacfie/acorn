---
title: Dashboards
description: Build panels over your data sources on Home and in plugins' views, with the panel editor, a model's help, history trends, and starter panels from plugins.
sources:
  - docs/dashboards.md
  - docs/dashboards/placements.md
  - docs/dashboards/mapping-and-editor.md
  - docs/dashboards/views.md
  - docs/dashboards/sampling.md
  - docs/dashboards/panels.md
  - docs/dashboards/supplied-rows.md
  - docs/tui/sources-and-settings.md
  - packages/client-core/src/features/dashboards/studio/PanelLauncher.tsx
checked: '266ec702a'
---

A dashboard is a grid of panels, and each panel shows records from your data sources: open pull
requests, Linear issues by state, agent sessions this week. Home is a dashboard, and some plugins keep
room for panels beside their own views. This page covers making panels, where they go, and keeping a
history.

## Add a panel to Home

1. Click **Home** in the left rail. With nothing on it yet, it shows **Add panel**.
2. Click **Add panel** and choose how to start:
   - **Describe it.** Type what you want to see, such as "open pull requests waiting on my review",
     and click **Draft it**. A model drafts the panel ([Model providers and generating
     text](/docs/agents/model-providers-and-generating-text/)).
   - **Start from data.** Pick a source, such as GitHub pull requests, then one of its starter
     panels or **Blank panel**. Plugins that offer a source offer starter panels with it.
   - **Unfinished.** Pick up a panel you started and didn't publish.
3. The panel editor opens. Adjust the panel, then click **Publish…** and review it.

   The panel appears on Home.

The editor saves as you go, so closing it loses nothing. Changes reach Home only when you publish.

## Ask an agent for a panel

In a task's agent chat, ask for a view of your data, such as "graph pull requests over the last month
by person". The agent draws a panel card in the conversation, with a line above it saying what it
shows. Ask it to change the panel, such as "make it weekly", and it draws a new card; the old one
shrinks to one line with **Show**.

- **Add to dashboard** asks which Home tab, then puts the panel there. It stays live: a window you
  stated as "last month" moves with time, and "my" means whoever looks at the panel.
- **Edit in studio** opens the panel editor on a copy. Changes there don't change the card.

When none of your data sources has what you asked for, the agent can gather the rows itself. Ask for
the forecast for this week, or your commits across every repository on disk, and it reads a web page
or runs `git log`, then draws what it found. The card says where the rows came from and when the
agent read them, with a link to each page it read. Nothing refreshes those rows, so the panel has no
refresh button. **Add to dashboard** offers two choices for it:

- **Place as a snapshot** puts it on the tab as it is, with the same line.
- **Keep it up to date** opens a sheet. Name the dataset, choose how it keeps rows, and optionally
  choose **Every day at 09:00** or **Every hour** to refresh it on a schedule. **Create** stores the
  rows as a dataset and puts a panel that reads it on the tab. The panel says when an agent last
  refreshed it, and **Ask an agent to refresh** asks an agent in the same task for fresh rows. A
  scheduled refresh that's late shows as a gap under the panel.

The agent never adds a panel to a dashboard itself. A card runs only while it's on screen.

## The panel editor

The editor has an outline on the left, a live preview, and a form for the selected part. The outline's
sections are **Data**, **Columns**, **Steps**, **Arrange**, **Look**, and **Settings**:

- **Data** is the sources the panel reads, each with its account. A panel can read more than one
  source and line their records up.
- **Columns** are the fields the panel shows. Hide one and it can still sort, filter, or group.
- **Steps** filter, calculate, summarize, and combine rows, up to eight. Each shows how many rows go in
  and come out, such as **312 → 41**.
- **Arrange** sorts, groups, and limits.
- **Look** picks the view, and **Settings** has the rest.

Conditions offer values that suit the field: a field's own choices, **You** for a person, and dates
such as **Start of this week** or **30 days ago**.

**Ask AI** opens a conversation beside the outline. A model proposes a change, and the outline and
preview show **Before** and **After** until you **Apply** or **Discard** it. The **JSON** tab shows the
whole panel as JSON.

## Views

| View | Shows | Needs |
| --- | --- | --- |
| Stat | One number, with an optional trend | Nothing |
| List | One row per record | Nothing |
| Table | Rows and columns | Nothing |
| Board | A column per value, like a kanban board | A field with a fixed set of values, such as a state |
| Chart | Bars by category or person, side by side or stacked by a series, or a line over time | A field with a fixed set of values, a person, a date, or a text field the panel groups by |
| Heatmap | A grid of shaded cells across two fields, such as weekday by hour of day | Two fields with a fixed set of values or people, or a summary by weekday, hour, or another time bucket |

The editor offers only views the panel's fields allow. On a board, dragging a card to another column,
or choosing **Move to** in its row's menu, changes that record in its source, when the source allows it. A
risky change asks first, and a failed one puts the card back.

## Use a panel

- Click a row to open the record, or use the buttons the panel adds to each row.
- Click a group's header or a stat's number to see the rows behind it. **Add as panel** turns that
  view into a panel of its own.
- The panel's menu renames it, changes its view or sort, and has **About this panel**, which says what
  it reads and does, and **Edit**.
- **Remove from this dashboard** takes a panel off this dashboard. **Delete panel** deletes it
  everywhere, and asks first.

When a source can't answer, the panel says why, with a fix: **Choose an account**, **Reconnect…**,
**Review** for a plugin waiting for your approval, or **Try again**. A panel that already had data keeps
it on screen, greyed out, under the message.

## More dashboards on Home

Home can hold up to eight dashboards in each workspace, as tabs. **+** adds one, and each tab's menu
renames, moves, or deletes it. A panel moves to another dashboard from **Move to** in its menu. Each workspace has
its own Home, so switching workspace switches the dashboards.

An app an agent built and you published to a project can sit on Home beside your panels. See
[Apps](/docs/built-in-plugins/apps/#put-an-app-on-a-dashboard).

## Panels in plugins' views

Some plugins keep a space for panels, such as beside a source's list in the left rail, or beside a
pane. You fill it the same way, with **Add panel**. The plugin may limit which sources or views it
shows, up to four panels by default, and the editor says why it refuses a panel there. Turning the
plugin off hides its space, and the panels come back with it.

## Keep a history

A stat can show a trend. acorn records its number every hour on the Node, whether or not acorn is open,
and keeps a value an hour for 14 days, then a value a day for 400 days. Changing what the number
measures, such as its filter or source, starts the history again. Renaming or moving the panel
doesn't.

To keep the records themselves, use **Keep history** in the editor. It makes a dataset from the
panel's query, captured on a schedule you approve, and the dataset becomes a source you can build
panels on. Choose how it stores records, which you can't change later:

| Mode | Keeps |
| --- | --- |
| **Keep the latest state** | Each record as it is now. A record that disappears is marked removed. |
| **Keep every event** | Every event, with when it arrived. |
| **Keep daily snapshots** | Each record as it was at each capture. |

**Settings** > **Automation** > **Datasets** lists datasets, with their size and coverage, and deletes
them. A dataset keeps rows for 90 days unless set otherwise. A panel over a dataset shows any gaps in
what it captured.

## In the terminal

The terminal client doesn't draw dashboards. Home and the panel spaces in plugins' views are in the
desktop app only, and an agent's panel card in a chat is one line saying what the panel shows.

## Limits

- A panel shows what its sources return. A source whose plugin or account is missing shows as
  unavailable, never as empty.
- A dataset summary returns at most 5,000 rows, and drilling into one shows up to 1,000.
- A trend skips an hour when a source answered only in part, rather than recording a number that
  never happened.
