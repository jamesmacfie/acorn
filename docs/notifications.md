# Notifications

acorn reads what each agent is doing, decides which three changes are worth interrupting you for,
and passes each one through a single gate. Sound, the system notification, the number on the app
icon, and the terminal's escape sequences all hang off that gate, and Settings switches each one.
Read this page to find the part of the model you need.

This page and its topic pages own the model. Other pages own the parts around it:

- [Plugin map](./plugin-map.md) § Notifications owns which call a plugin author reaches for.
- [Shell](./shell/bridge-and-broker.md) § The renderer bridge owns the desktop half of the `notify` seam group.
- [Terminal chrome](./tui/chrome.md) § What is drawn bespoke owns the terminal client's
  bell and badge.

## A notice is not an attention item

The bell in the top bar draws two kinds of row. The difference decides where a thing belongs.

A **notice** is an event that already happened: a run finished, a build failed, an agent asked a
question. It's client-local, it carries a `read` flag, and it drops out once 50 newer rows push it
off the ring. `packages/client-core/src/features/notifications/notifications.ts` holds the ring.

An **attention item** is a state that lasts until something changes on the Node. A pending approval
is still pending after you dismiss it, so it comes back on the next fetch. That's why the client
fetches items per Node instead of receiving them as pushes, why they carry no `read` flag, and why a
plugin contributes them through `ctx.attentionSources`
(`packages/client-core/src/host/registries/rail/attention.ts`,
[contribution kinds](./contribution-kinds.md)). The bell's "Needs you" section shows these rows,
merged across every Node.

Both kinds say where a click lands. For an attention item, `target` is a required field. A row in
the inbox asks you to go and deal with something, so a row that ignores the click teaches you the
whole section is decoration. A source with nowhere to send you has no row to draw. The bell and the
terminal inbox both act on the target alone, so an item about the Node instead of a task works too.

Both kinds come from the same reading of a session.

## Pages

<a id="five-states"></a>
<a id="three-edges"></a>

[States and edges](./notifications/states-and-edges.md) covers the five states, how the managed and
terminal adapters map sessions to them, and the three edges that raise a notice.

<a id="what-a-row-points-at"></a>
<a id="raising-one-from-a-plugin"></a>
<a id="getting-there-before-the-target-runs"></a>
<a id="what-a-row-is-drawn-with"></a>
<a id="archiving-a-task-takes-its-notices-with-it"></a>

[Rows and targets](./notifications/rows-and-targets.md) covers what a row points at, raising a
notice from a plugin, the order a click navigates in, row glyphs, and what archiving a task removes.

<a id="the-gate"></a>
<a id="acknowledging-an-attention-row"></a>
<a id="the-invariants"></a>

[The gate](./notifications/gate.md) covers the hold, the seen rule, acknowledging an attention row,
and the invariants the tests hold.

<a id="the-channels"></a>
<a id="settings"></a>

[Channels and settings](./notifications/channels.md) covers sound, the system notification, the
badge, the terminal sequences, and the settings that switch them.
