# Phase 1: agent-made panels

Status: proposed, 2026-10-19. Depends on nothing. Read [design.md](./design.md#agent-made-panels)
first.

## Goal

An agent turns "graph me X" into a dashboard panel inside the conversation. The owner adds it to a
dashboard with one click, and it stays live there, because it stores where its data comes from and
how to shape it, not the data. Nothing in this phase uses OpenUI.

## What the owner gets at the end

- "Graph pull requests over the last month by person" produces a card in the conversation. It draws
  the dashboard's own bar chart, under a line that says what it shows, such as "Pull requests opened
  in the last 30 days in acme/api, counted by author."
- "Make it weekly" produces a new card. The old one collapses to a line with **Show**.
- **Add to dashboard** puts the panel on the Home tab the owner picks. It refreshes there like any
  panel, and the window keeps moving: tomorrow it shows the 30 days up to tomorrow.
- **Edit in studio** opens the panel studio on a draft of the plan.
- A plan that doesn't validate never draws. The agent sees the problems and tries again.

## Starting point

- Plans, the run route, publication, Home tabs, and the panel studio ([dashboards](../../dashboards.md)).
- The studio's AI instructions in `packages/node-core/src/server/routes/authoring.ts`, built on
  `PANEL_CAPABILITIES` from `packages/dashboards-core/src/capabilities.ts`.
- The drill-down's **Add as panel**, which publishes a derived plan
  ([panels](../../dashboards/panels.md#provenance-and-what-a-row-may-not-claim)).
- The data source agent tools, which return descriptors and schemas and no records
  ([agent tools](../../agent-tools.md)).
- The `agents:tool-card` point, declared in `plugins/agents/src/client/index.ts`.

## Requirements

### Tools

1. `panel_guide` returns the plan instructions the studio's AI gets, built from the same text and
   `PANEL_CAPABILITIES`, plus advice on choosing a view and two worked examples. The guide and the
   studio's AI read one source, so a change to either changes both.
2. `panel_show` takes a title, a panel ID when it revises an earlier card, and a draft plan. It
   validates the plan on the Node and draws a panel card. It stores nothing on the Node, because the
   plan lives in the tool call.
3. A plan that fails validation returns every problem, with its path into the plan, and draws no card.
4. `panel_show` never returns records.

### Plans that work anywhere

5. A plan can't refer to the task it was made in. The agent writes the repository, project, and
   account as values.
6. The guide tells the agent to write a window the person stated relatively, such as "last month", as
   a relative date.
7. The guide tells the agent to write "me" and "mine" with the person filter's **You**.

### The card

8. The card runs the plan through the ordinary run route under the owner's device, and draws it with
   the dashboard's own view, including the unavailable and failed states a placed panel has.
9. The card shows the plan's plain-language description, which the run returns, above the view.
10. A card for an existing panel ID is a new version. Older versions collapse to one line with the
    agent's title and **Show**, which draws that version again.
11. A card caps at 480 pixels with **Expand**, and runs its plan only while it is in view.
12. Rows in a card have the same press, buttons, and row menu as on a dashboard.

### Add to dashboard

13. **Add to dashboard** asks for a Home tab in the task's workspace, then creates a dashboard draft
    from the plan, publishes it, and places it, all under the owner's device.
14. After adding, the card names the tab and offers **Open**, and a toast offers **Edit…**, as the
    drill-down's **Add as panel** does.
15. **Edit in studio** opens the panel studio on a new draft of the plan. Changes there don't flow back
    to the card.

### Terminal client

16. In the terminal transcript, a panel card is one line with the plan's description, saying the panel
    draws in the desktop app.

## Out of scope

- An agent changing a panel already on a dashboard. **Edit with AI…** in the studio does that.
- Agents publishing or placing panels. See [refused](./refused.md#agents-that-publish-or-place-panels).
- Plugin regions as a target for **Add to dashboard**. See [the open questions](./README.md#open-questions).
- Drawing panels in the terminal client.
- Apps. They start in [phase 2](./02-renderer-and-spike.md).

## Steps and checkpoints

### 1. Tools

**Checkpoint 1.** Call `panel_show` by hand through MCP with a starter plan from the GitHub pull
requests source. A card draws. Call it with a plan that groups by a field the source lacks. It fails
with the path to the group, and no card appears.

### 2. The card and its versions

**Checkpoint 2.** Show a second plan with the first card's panel ID. The first card collapses, and
**Show** draws it again. A row's menu offers the same actions as on a dashboard.

### 3. Add to dashboard

**Checkpoint 3.** Add the second version to a second Home tab. The panel appears there, refreshes when
the window regains focus, and survives a restart of the desktop app. **Edit…** opens it in the studio.

### 4. An agent builds one

**Checkpoint 4.** In a managed Claude chat, ask for "pull requests over the last month by person, as a
chart". The agent reads `panel_guide` and shows a bar chart over a relative 30-day window, counted by
author. Ask "make it weekly", then add it to Home. The next day, the panel's window has moved.

**Checkpoint 5.** Run the same chat in the terminal client, in the isolated PTY driver. Each card is
one line.

## Docs that change

- [Agent tools](../../agent-tools.md): `panel_guide` and `panel_show`.
- [Dashboards](../../dashboards.md): panels made in a conversation, and **Add to dashboard**.
- [Managed agents](../../managed-agents.md): panel cards in the transcript.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- Which plan checks can run on the Node for a task's agent. Every dashboard route needs a device
  principal (`packages/node-core/src/server/routes/dashboards.ts`), and the data source agent tools
  describe sources for task principals. Shape and source checks should run, and record reads should
  not.
- That no source parameter or query binding resolves from the current task. If one does,
  **Add to dashboard** turns it into a value first.
- How a core feature fills `agents:tool-card`, or whether the agents plugin draws panel cards itself
  with the dashboard views.
- How the drill-down's **Add as panel** creates, publishes, and places, so **Add to dashboard** reuses
  it.
- Whether the studio's authoring evaluation cases can run against `panel_guide`, so both writers are
  measured the same way.
