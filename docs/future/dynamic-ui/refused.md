# What agent-built apps refuse

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang. Each entry says what was considered,
why it is out, and what would make it worth revisiting.

## Agent-written JavaScript trees

The agent writes a plugin client file that runs in the sandboxed tree tier and draws kit components.
It has no ceiling on logic, and it is how a hand-written plugin draws. For an app, it costs a sandboxed
worker per card, a headless boot on the Node to validate, a reserved plugin ID prefix, an install per
revision, and a per-Node trust grant that waives the per-hash prompt, with its own security review. An
OpenUI program needs none of that, because it runs no code.

Revisit if phase 0 shows agents can't express common apps in OpenUI Lang, even with library functions
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
OpenUI program over the kit gives an agent the host's own components instead.

Revisit if phase 0 shows agents cannot express common apps with the library. The frame tier exists for
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
nothing specific to show. Apps read through data source tools and act through row actions. See
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
second owner type, a second rail rule, and a second route.

Revisit when someone needs one app across the projects of a workspace, with an example.

## An app that sends messages

An app could post to the conversation on the owner's behalf. `@ToAssistant` puts text in the composer
instead, so the owner decides.

Revisit never. A message the owner did not send is a message the owner did not write.

## Dashboard panels as the only answer

A dashboard panel already draws a list, table, board, stat, or chart over typed data sources, with no
code. Many apps an agent builds would be one of those. Panels cannot hold state, combine sources with
logic, or draw a form, and there is no agent tool that creates one.

Revisit after phase 0. If most spike apps turn out to be single-source tables or charts, an agent tool
that creates a dashboard panel is cheaper than an app, and the authoring guide should send agents there
first.
