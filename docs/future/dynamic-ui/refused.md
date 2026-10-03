# What agent-built apps refuse

Status: proposed, 2026-10-01. Each entry says what was considered, why it is out, and what would make
it worth revisiting.

## HTML in an iframe

Lemma's model. The agent writes markup and styles, and the host frames it. It is quick to start and
unlimited in what it can draw, but nothing looks native, the host's keyboard and focus rules do not
reach inside, every app restyles itself from tokens, and nothing renders in the terminal client.
Acorn's tree tier gives an agent the host's own components instead.

Revisit if phase 0 shows agents cannot express common apps with the kit. The frame tier exists for
pixels the host cannot draw, and an app that needs a canvas could use it under a wider profile.

## A static component schema

The agent sends JSON naming blocks, and the host has a renderer per block. The descriptors doc already
refuses this as "a widget toolkit in the wire format": it is always one field short, and logic ends
up reinvented inside the JSON. A tree keeps logic in the app's own code.

Revisit never, for the reasons in [descriptors, trees, rectangles](../../plugins/ui-tiers.md).

## One left-rail icon per app

Each promoted app as its own rail source would crowd the rail and let generated code choose chrome.
One **Apps** source lists them instead.

Revisit if the owner wants a handful of apps pinned, and then as a pin on the **Apps** source rather
than new sources.

## Apps in chrome

Topbar chips, footer badges, rail markers, and palette rows are descriptors the host draws. An app
does not get to fill them.

Revisit by growing the descriptor vocabulary, not by opening a slot to apps.

## Access to every plugin's capabilities

An app would become as powerful as the strongest plugin on the Node, and the trust prompt would have
nothing specific to show. Apps read through declared data sources and act through row actions. See
[what an app can reach](./design.md#what-an-app-can-reach).

Revisit per capability, by turning a useful capability into a data source or a row action.

## A node half, network access, or secrets in an app

Each one breaks the argument that makes app trust safe to grant without a prompt per revision. An app
that needs them exports as a plugin and goes through the ordinary review.

Revisit never for apps. Export covers it.

## Live old revisions

Old cards running their own revision would need two installed versions of one package, which the
plugin host does not support. A card that follows the head, Lemma's model, makes history lie. Old
cards collapse to a one-line record with **Restore**.

Revisit if the host can replay a recorded tree without running code. Then an old card could show a
frozen picture of what it looked like.

## Workspace-scoped apps

The data sources, tasks, and memory an app relates to are project-scoped. A workspace scope would add a
second owner type, a second rail rule, and a second route.

Revisit when someone needs one app across the projects of a workspace, with an example.

## JSX or a bundler on the Node

The loaded-plugin profile already refuses a bundler in the Node: size, supply chain, and a compile step
inside the trusted process. The scaffold writes plain JavaScript, and apps do the same.

Revisit on the terms [installing a hand-written package](../../plugin-authoring/installing-a-hand-written-package.md)
sets: real friction, measured, not anticipated.

## An app that sends messages

An app could post to the conversation on the owner's behalf. Compose puts text in the composer
instead, so the owner decides.

Revisit never. A message the owner did not send is a message the owner did not write.

## Dashboard panels as the only answer

A dashboard panel already draws a list, table, board, stat, or chart over typed data sources, with no
code. Many apps an agent builds would be one of those. Panels cannot hold state, combine sources with
logic, or draw a form, and there is no agent tool that creates one.

Revisit after phase 0. If most spike apps turn out to be single-source tables or charts, an agent tool
that creates a dashboard panel is cheaper than an app, and the authoring guide should send agents there
first.
