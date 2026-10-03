# Cooperative extension points

This page covers how one plugin adds something inside another plugin's surface without importing it:
the five kinds of point, the rules all of them follow, and how the host picks who fills a box. It's
part of the [plugin reference](../plugins.md). Each kind has its own page:

- [Rows and annotations](./rows-and-annotations.md)
- [Remote points](./remote-points.md), including rectangles
- [Hooks](./hooks.md)

## Cooperative extension points

Plugin A declares a point inside one of its own surfaces, and plugin B declares what it puts there.
`@acorn/protocol/extensionPoints.ts` holds the vocabulary. The Node checks it at parse, the client
checks it again on arrival, and the host mints every name.

### Five kinds, four rules

What a contributor brings is one of five kinds, and the kind is a field on the point. `kind` defaults
to `rows`.

| | `rows`, `annotation` | `remote` | `rectangle` | `hook` |
| --- | --- | --- | --- | --- |
| What crosses | Records | A tree of host components | Nothing. An iframe is placed | A payload and a verdict |
| Plugin code on the client | None | In a worker | In its own iframe | None. A Node route |
| Needs a client bundle | No | Yes | Yes | No |
| Can open a modal or menu | No | Yes, host-drawn | Yes, in its own overlay | Not applicable |
| Cost of N contributors | N route reads, batched | N live subtrees | N iframes | N route calls |
| The host can index it | Yes | No | No | No |
| Best for | Facts about many items | UI in another plugin's surface | Owning pixels | Acting before something happens |

Ask in this order:

1. Is it a decision, not a drawing? Use a hook.
2. Is it a fact about one item the owner already draws? Use an annotation.
3. Is it a list of things with names? Use rows.
4. Can you build it from acorn's own components? Use a remote tree.
5. Does it own pixels, heavy typing, or a third-party library such as a canvas or a chart library?
   Use a rectangle.

The line between descriptors and trees is data versus code, not simple versus complex. When someone
asks for a conditional in a row, the answer is a remote card. Most third-party plugins will be a rail
source, a pane, and a few remote cards.

All five kinds follow the same four rules:

| Rule | What it means |
| --- | --- |
| The owner consents in its manifest | A point A didn't declare receives nothing |
| The host mints every name | A point is `<ownerId>:<pointId>`, stamped from the plugin the manifest was read under. B can't advertise a point in A's name, and B's manifest names A |
| Both sides appear in the trust prompt | With host-owned copy. A plugin id and a verb come from fixed tables, never from manifest text |
| Code doesn't cross | Rows, marks, a component tree, or a typed payload travel. The host carries, checks, and draws or runs them |

### Where a point id lives

Core's own points and the first-party points core's consumers name, such as `agents:*` and `core:*`,
are in `@acorn/protocol/extensionPoints.ts`, because both ends compile against protocol. A plugin's
own points, such as `changes:diff-line` and `docker:container`, are in that plugin's own
`extensionPoints.ts`. A contributor in another plugin spells the string, because it can't import the
owner's module. A typo shows up on the plugin's page as a contribution whose point nobody declares.

### In the terminal

Both hosts read the same registry and the same arbitration. Only the drawing differs.
[What a plugin loses in the terminal](../tui/plugin-losses.md#what-a-plugin-loses-here) is the table.

## Arbitration

`remote` and `rectangle` points declare one of two modes:

| | `stack` | `replace` |
| --- | --- | --- |
| Occupants | Every matching contributor, up to `max` | Exactly one: the best match for the `key`, or the owner's default |
| Selector | Optional. Contributors may still filter with `matches` | Required in practice. The owner passes `key` when it draws the slot |
| Example | Buttons in a composer | The renderer for the selected attachment |

`matches` takes an exact string, a trailing star as a prefix (`image/*`), or a leading star as a
suffix (`*.md`). A contributor that names none matches every key.

`max` matters for `stack`, because each remote contributor is a live subtree and each rectangle is an
iframe. Past `max`, the host draws a count of what was left out, with no names.

When two contributors match the same key in `replace` mode, the person picks in **Settings > Advanced
> Extension points**, and the owner's default draws until they do. A pick naming a plugin that stopped
matching falls back to the owner's default, not the runner-up, so a box never changes hands because
somebody uninstalled something.

## What the host binds

A manifest can't state any of these:

| | |
| --- | --- |
| The point's public name | `<owner>:<point>`, minted from the plugin the manifest was read under |
| The provenance | Every delivered group and mark is stamped with the contributing plugin's id, drawn beside the content |
| The fetch | Confined to the contributor's own `/v1/p/<id>/`. A contribution can't make the host read the owner's routes |
| The gate | Nothing is delivered unless both plugins run on the Node being looked at and neither has code this device withheld. A `remote` or `rectangle` contribution also needs this device to have accepted the contributor's bundle |

Rows are drawn with the shell's own `Row`, `Badge`, `SectionHeader`, and `Icon`, in host markup outside
A's iframe. A never receives B's data, and B never touches A's document.

An unmatched contribution is silent. When A isn't installed, is disabled on this Node, had its bundle
refused here, or dropped the point in an update, the contribution delivers nothing, with no error.
The two halves come from two manifests registered in an order nobody controls, so delivery resolves
at read time.

Both directions appear in the trust prompt under **Enforced** and are recorded with the decision. A
version that starts reaching into a different package, or bringing a different kind of thing, reads
as newly requested.

## Seeing what matched

Silence is right for a user and hard for an author, because a typo in `point` produces an empty pane.
**Settings > Advanced > Extension points** lists every point on this Node with its kind, mode, and
contributors. It also lists every contribution whose point nobody declares, with a nearest-name
suggestion, and the picker for a tied `replace` slot. It reads the same registries the hosts read.

## There is no uncooperative extension

Nothing lets plugin B change plugin A's UI or behavior without A's declared consent. These are
refused permanently:

- **DOM access into another realm.** Some tools let any plugin rewrite any other plugin's rendered
  DOM. That makes every plugin part of every other plugin's attack surface, and makes A's behavior
  impossible to debug from A's source.
- **Patching another plugin's registrations.** The host registers contributions from the manifest it
  read, and there's no runtime door onto anyone's, including the plugin's own.
- **Reading another plugin's routes.** Refused at manifest parse, again on the device, and a third
  time at the frame bridge (`packages/client-core/src/host/frames/scopes.ts`).

If a real need can't be expressed as a cooperative point, the answer is a wider vocabulary, not an
open realm. Memory's section inside the Context pane is the example: editable inputs, a select, a
textarea, and an accept-or-reject pair per proposal. It's a `context:section` contribution drawn from
kit nodes, not a bigger descriptor.

Nothing here is reachable from a plugin frame. The bridge has no message kind for reading a point's
deliveries or contributing to one.
