# What agent-built panels and apps refuse

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang and plans. Each entry says what was
considered, why it is out, and what would make it worth revisiting.

## Programs that query data sources directly

An app's `Query` calls a data source and the program filters, counts, and groups the rows itself. That
is a second way to fetch and shape data, beside dashboard plans, and a weaker one: OpenUI has no
grouping, joins, or time buckets. It would run outside the Node's cache and shared reads, skip the
honest partial and unavailable states, and make **Add to dashboard** a conversion instead of a
publish. [Dashboards](../../dashboards.md) already says the client doesn't run queries itself. An
app's queries run its plans instead.

Revisit never. A shape a plan can't express goes into the plan vocabulary, where dashboards get it too.

## Charts of the library's own

OpenUI chart and table components in the library, beside the dashboard's views. A chart in an app
would look and behave differently from the same chart on Home, with its own series colors, tones, and
empty states, and it would have no drill-down or row menus. The library draws charts and tables only
through `Panel`.

Revisit if an app needs a chart a plan can't express. Then add it to the dashboard views, so panels
get it too.

## Rebuilding the dashboard views in OpenUI

Drawing every dashboard panel as an OpenUI program, so there is one way to draw as well as one way to
shape. It would lose or have to rebuild drill-down, board moves with their write values, row menus,
provenance badges, and stat trends, for no gain the owner could see. `Panel` puts the real views inside
apps instead.

Revisit never.

## Agents that publish or place panels

An agent that adds its panel to a dashboard by itself. A dashboard is the owner's surface, and every
dashboard route needs a device principal. The agent drafts, and the owner's click publishes and
places.

Revisit if a workflow needs to keep a dashboard up to date on a schedule, and then as a workflow step
the owner approved.

## The chat agent asking the studio's AI

`panel_show` could hand the request to the panel studio's AI, a second model call. The chat agent
already holds the conversation, and a second model would need it retold and would answer at second
hand. The two share one set of instructions and one validator instead.

Revisit if the studio's AI does measurably better on the authoring evaluation cases than the chat
agent with the same guide.

## Panels only, with no apps

Stop after phase 1, and answer every request with a panel. Panels can't hold state, draw a form, or
put several plans in one layout with buttons that act on them. Many requests are a single panel, which
is why phase 1 comes first.

Revisit after phase 2. If most spike requests could have been panels, the programme ends at phase 1.

## Agent-written JavaScript trees

The agent writes a plugin client file that runs in the sandboxed tree tier and draws kit components.
It has no ceiling on logic, and it is how a hand-written plugin draws. For an app, it costs a sandboxed
worker per card, a headless boot on the Node to validate, a reserved plugin ID prefix, an install per
revision, and a per-Node trust grant that waives the per-hash prompt, with its own security review. An
OpenUI program needs none of that, because it runs no code.

Revisit if phase 2 shows agents can't express common apps in OpenUI Lang, even with library functions
added. Turning the app into a plugin covers a single case first.

## A UI language of our own

A format designed for Acorn, such as JSON that names kit components plus a small expression language.
It would fit the kit exactly, and Acorn would own its parser, evaluator, prompt, validation, editing
model, and specification. OpenUI has all of these, under the MIT license, with conformance cases. Its
framework-free core is about 10,000 lines of TypeScript, tests included, which Acorn could fork if
Thesys stops maintaining it.

Revisit if OpenUI's specification changes in a way stored programs can't follow, or the project stops.
Fork `lang-core` before designing anything new.

## OpenUI's React packages and hosted services

OpenUI's React renderer, its chat components, its Gateway that repairs model output, and its cloud
observability. Acorn draws in Solid, and the hosted services would send programs to a third party.
Acorn uses `lang-core` and its own renderer.

Revisit never. Validation errors go back to the agent, which fixes its own program.

## Streaming programs in the agent's reply

OpenUI draws a program while the model streams it, from the model's own reply text. Acorn doesn't own
a harness's system prompt, and a program drawn from a reply couldn't be validated before the owner
saw it. Programs arrive whole through `app_show`.

Revisit if a harness lets Acorn validate a fenced block before drawing it, and streaming shortens the
wait enough to matter.

## HTML in an iframe

Lemma's model. The agent writes markup and styles, and the host frames it. It is quick to start and
unlimited in what it can draw, but nothing looks native, the host's keyboard and focus rules do not
reach inside, every app restyles itself from tokens, and nothing renders in the terminal client. An
OpenUI program over the kit and the dashboard views gives an agent the host's own components instead.

Revisit if phase 2 shows agents cannot express common apps with the library. The frame tier exists for
pixels the host cannot draw, and an app that needs a canvas can become a plugin and use it there.

## A static component schema

JSON that names blocks, with no state or expressions, such as Slack Block Kit. It is always one field
short, and the first `if` has nowhere to go. OpenUI Lang has expressions, state, queries, and actions,
and a library can add functions, so a program has somewhere to put the `if`.
[Descriptors, trees, rectangles](../../plugins/ui-tiers.md) refuses static schemas for plugins, and that
refusal still holds there.

Revisit never.

## One left-rail icon per app

Each promoted app as its own rail source would crowd the rail and let generated content choose chrome.
One **Apps** source lists them instead.

Revisit if the owner wants a handful of apps pinned, and then as a pin on the **Apps** source rather
than new sources.

## Apps in chrome

Topbar chips, footer badges, rail markers, and palette rows are descriptors the host draws. An app
does not get to fill them.

Revisit by growing the descriptor vocabulary, not by opening a slot to apps.

## Access to every plugin's capabilities

An app would become as powerful as the strongest plugin on the Node, and the trust prompt would have
nothing specific to show. Apps read through their plans and act through row actions. See
[what an app can reach](./design.md#what-an-app-can-reach).

Revisit per capability, by turning a useful capability into a data source or a row action.

## A node half, network access, or secrets in an app

A program has no way to express any of them, and a host tool that offered one would let a
prompt-injected agent's app reach it with no prompt in the way. An app that needs them becomes a
plugin and goes through the ordinary review.

Revisit never for apps. Turning an app into a plugin covers it.

## Interactive old revisions

Old cards that keep their inputs and actions working for their own revision. The app's state belongs
to the head, an old revision may read it in a shape it doesn't expect, and two interactive versions of
one app on screen leave the owner guessing which one acted. A card that follows the head, Lemma's
model, makes history lie. Old cards collapse to a one-line record that can show the revision read
only, with **Restore**.

Revisit if owners keep restoring old revisions to use them side by side, which says they want two
apps.

## Exporting a program with a runner

**Turn into a plugin** could copy the program into a package with a prebuilt bundle of `lang-core`, the
renderer, and a library bound to the tree tier's kit nodes. The plugin would draw the same UI with no
rebuild. It would need a third library binding and a runner bundle in every exported package, and the
plugin's UI still couldn't go past the language, which is why the owner wanted a plugin.

Revisit if owners turn apps into plugins often and the rebuilt plugins drift from their apps.

## Workspace-scoped apps

The data sources, tasks, and memory an app relates to are project-scoped. A workspace scope would add a
second owner type, a second rail rule, and a second route. An app cell on a workspace's Home tab names
its project instead.

Revisit when someone needs one app across the projects of a workspace, with an example.

## An app that sends messages

An app could post to the conversation on the owner's behalf. `@ToAssistant` puts text in the composer
instead, so the owner decides.

Revisit never. A message the owner did not send is a message the owner did not write.
