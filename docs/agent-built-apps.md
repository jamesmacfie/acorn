# Agent-built apps

An agent builds a small UI for the task it's working on and shows it in the conversation. An app is
an [OpenUI Lang](https://www.openui.com/docs/openui-lang) program and the dashboard plans it reads.
Acorn's own interpreter, kit, and dashboard views draw it, so nothing the agent wrote runs as code and
no device asks to trust it. For one view of one plan, an agent uses a panel card instead
([dashboards](./dashboards.md#panels-from-a-conversation)).

The first-party plugin `trellis` hosts apps (`plugins/trellis`). "App" is the product word. The code
name keeps the plugin apart from the repository's `apps/` folder and from the desktop app. For the
design and the phases still to come, read [agent-built panels and apps](./future/dynamic-ui/README.md).

## Files

An app is a folder under the Node's data root. It is never in a task's worktree, so a task's diff
never carries one.

```text
apps/<appId>/
  app.json              the task, name, description, and head revision
  working/program.oui   the program the tools edit
  working/plans/<name>.json
  revisions/<n>/        what app_show published: program, plans, and revision.json
```

`revision.json` records the library ID and version the program was written against, the agent's
one-line note, and, for a restore, the revision it copied. Revisions never change. Every app belongs to
one task. Archiving the task keeps its apps, and deleting the task deletes them.

## Tools

Seven task-scoped tools build an app ([agent tools](./agent-tools.md#apps)). An agent reads
`app_guide`, creates the app with `app_create`, writes plans and the program with `app_write`, changes
the program with `app_patch`, and shows it with `app_show`. `app_write` and `app_patch` need the hash
of the file as it was last read, so two sessions editing one app don't overwrite each other. A file is
at most 256 KiB. A tool call on another task's app fails as if the app didn't exist.

The tool declarations are on the Node's boot path. What the tools do, and lang-core with it, loads on
the first call, about 100 KB.

## The library

The library is the set of components and functions a program can use. Nothing else parses. The spec
half, each component's props and description, is `plugins/trellis/src/shared/library.ts`. The Node
validates programs and writes the guide from it. The client half, `plugins/trellis/src/client/bindings.tsx`,
draws each component with a kit component through `@acorn/plugin-api/ui`, so one binding draws in the
desktop app and the terminal client.

| Kind | Members |
| --- | --- |
| Layout | `Stack`, `Card`, `Heading`, `Text`, `Badge`, `Alert`, `Empty`, `List`, `ListItem` |
| Form | `Button`, `Checkbox`, `Input`, `Textarea`, `Select`, `SelectItem`, `Form` |
| Data | `Panel(plan, inputs)`, which draws one of the app's plans with the dashboard's own panel |
| Functions | `@Includes(list, value)`, `@Toggled(list, value)`, `@GroupBy(rows, field)`, beside OpenUI's built-ins |

A `Card` in a row `Stack` is as wide as its content. A set of ticked rows is a `$` variable holding a
list: `@Includes($ticked, r._id)` checks a row's box, and `@Set($ticked, @Toggled($ticked, r._id))`
flips it. The library has no chart or table besides `Panel`.

Programs pass props by position, so a stored program depends on their order. Add a prop only at the
end, never reorder or remove one, give a new required prop a default, and raise `LIBRARY_VERSION`.

## Validation

`app_show` checks the working files on the Node, in this order, and publishes nothing if any check
fails:

1. The program is at most 64 KiB.
2. Every plan passes the checks `panel_show` runs. They describe the plan's sources and read no
   records.
3. lang-core parses the program against the library with no errors. Warnings go back to the agent.
4. Every `Query` and `Panel` names one of the app's plans, or the `task` tool, with a string literal.
   The only `Mutation` is `rowAction`. Every plan is used.
5. The program doesn't declare or set `$placement`.
6. The program isn't one `Panel` and nothing else. That's a panel, and the error points to `panel_show`.
7. The program evaluates once against each query's defaults with no runtime error.

A failure lists every problem as `code path: message hint`, and the transcript shows that the app
didn't pass instead of a card.

## Cards

The card for `app_show` is `plugins/trellis/src/client/AppToolCard.tsx`, placed in the agents
plugin's `agents:tool-card` point. It loads with the first app card in a transcript, and lang-core and
the renderer with it. The card reads the revision's files through `/v1/p/trellis/apps/<appId>`, a
device-only route.

Each card pins the revision its call published. Only the card that shows the app's head is
interactive. Older cards collapse to "v2: added owners. Replaced by v3." with two buttons:

- **Show v2** draws that revision read only. Its buttons and fields are off and its actions do nothing.
  It draws with current data.
- **Restore v2** publishes v2's files as the next revision and copies them into the working files, so
  the agent's next edit starts from them. The card that asked draws the new revision. Restore is a
  device-only route, so an agent can't call it.

A card caps at 480 pixels with **Expand**. Its plans first run when it comes into view, and its panels
pause while it's off screen. `$placement` is `card`. A program's `$` variables last while the card is
open and aren't saved, so ticks and typed values are gone after a reload.

## What an app can reach

A program reaches only what the card hands it, and the card checks each call. The code is
`plugins/trellis/src/client/AppView.tsx`.

| What | In a program | What the host does |
| --- | --- | --- |
| The app's plans | `Query("name", inputs, defaults)`, `Panel("name", inputs)` | Runs the plan from the revision's files through the dashboard run route, under the viewer's device. A query's rows are each row's values plus `_id` and `_actions`. |
| Plan inputs | The second argument to `Query` or `Panel` | Sent as the run's `inputs`. The Node fills the plan's `{ from: "input" }` addresses with them, and the run fails if a plan reads one that wasn't passed. |
| The task | `Query("task", {}, {})` | Returns the ID, title, and branch of the task the card is drawn in. |
| Row actions | `Mutation("rowAction", {plan, row, action})` and `@Run` | Finds the row and action in its own last run of that plan, shows a confirm, and then calls the data source's action route. A program can't name a record or an action the source didn't offer. |
| Compose | `@ToAssistant(text, context)` | Puts the text in the task's agent composer as a draft. It never sends. |
| Links | `@OpenUrl(url)` | Opens HTTP and HTTPS URLs only, after a confirm that shows the full URL. Anything else does nothing and says why. In the terminal, the confirm copies the link instead. |

The host copies every value that leaves a program into plain JSON data first (`plainData`). A program
can read a built-in function off any value and put it on an object as `toString` or `toJSON`, and
coercing that object would call the function. The functions a program can reach are JavaScript
built-ins, none of which runs program text, but the host doesn't call them either. lang-core's own
evaluator can still make that zero-argument call while it evaluates an expression.

Built-in and library functions are pure. A program can't define a function, reach the network, read a
secret, or start a process, because the language has no way to say any of those. For the threat model,
see [security](./security.md#agent-built-apps).

## In the terminal

The terminal client draws app cards with its own kit, capped at 24 rows. A `Panel` draws as one line
that says the panel draws in the desktop app. The terminal bundles lang-core, as it bundles Zod.

Both the Node and the terminal client set `OPENUI_TELEMETRY_DISABLED`, because lang-core reads the
process environment for its opt-in usage reports. Its install script, which only reports an install,
is denied in `pnpm-workspace.yaml`.
