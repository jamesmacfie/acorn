# Tooltips

This page covers the tooltip attributes, how the tip positions itself, tips inside plugin frames, and
the help mark. Read it before you add a tooltip or an explanation to a setting. It's part of
[UI design](../ui-design.md).

## Tooltips

A tooltip is six data attributes, honored on any element, not a `<Tooltip>` wrapper:

| Attribute | Meaning |
| --- | --- |
| `data-tip` | The tip text. Required. No attribute, no tip. |
| `data-tip-sub` | A second, muted line. |
| `data-tip-key` | A keyboard chord, drawn as a key cap. |
| `data-tip-at` | An event's time in epoch milliseconds. The muted line becomes its age, worked out when the tip opens. |
| `data-tip-legend` | A JSON array of status markers: icon name, `StatusDot` tone, color tone, and meaning. `RailTab` writes this from its own markers. |
| `data-tip-kind` | `help` draws the text as an explanation: body weight, paragraph line height, and up to `min(22rem, 90vw)` wide instead of 260. Only the help mark sets it. |

Write a chord with `formatChord` (`kit/lib/rendering/formatChord.ts`, and `@acorn/plugin-api/client`
for a plugin). It reads the registry's `meta+shift+n` and the keymap's `shift+super+n` alike, and
writes the modifiers as ⌃⌥⇧⌘ in that order, then the key: ⇧⌘N, ⌘↩, ⇧?. Pane tips, key caps, the find
bar, and the cheat sheet all use it.

Attributes beat a wrapper component, because a wrapper adds an element that changes layout.
Attributes work on plugin markup, need no listener per element, and cost one delegated listener for
the whole document. Native `title` is fine only where the styled tip can't reach, such as inside
xterm's canvas, or where it repeats a name the element cut short, as a tab, a grid cell, or a list row
does. A row keeps `title` on purpose, because the styled tip opens at once and would flash on every
row of a file tree under a moving pointer.

Kit nodes write `data-tip`, never `title`. A `title` prop on `Button`, `IconButton`, `Chip`,
`Checkbox`, `Menu.Item`, a `Select` option, a `SegmentedControl` option, a `Tabs` tab, `Input`,
`Textarea`, and `Icon` draws as the styled tip. `Button`'s `tip` wins over its `title`. An
`IconButton` with neither shows its `label`. `Badge`, `StatusDot`, and `Link` take a `tip` of their
own. A tipped badge is a tab stop, as a tipped `Text` is. A dot's tip is asked for, not taken from its
`label`, because a labeled dot inside a tipped rail tab would answer the pointer first and hide the
tab's tip.

### Position

The tip is one element, positioned `fixed`, so it escapes a scrolling list that clips its children.
The right rail (`.pane-switcher`) prefers the left side, and everything else prefers the right. Once
drawn, the bubble is measured and flips to the other side when the preferred one would run past the
window's edge and the other wouldn't. It then moves up or down until it's at least `--space-4` inside
the top and bottom. The offset anchors to the pinned side with `right`, not `left` plus a transform,
so the bubble keeps its real width.

The tip doesn't close on Escape, and the pointer can't rest on it. Both would need the keymap, because
a tip open inside Settings mustn't swallow the Escape that closes Settings. A legend entry mirrors one
active rail marker, placed or not, so the tooltip both reports state and teaches what each mark
means.

### Tips inside plugin frames

A sandboxed plugin frame has its own document, so the shell's tip can't see elements in it.
`kit/lib/controls/frameTips.ts` mounts the same delegated listener and bubble into the frame's
document, as frames already mount their own copy of the shared CSS. It has no framework and no
imports, because it's reached from `@acorn/plugin-api/ui/sdk`, which bundles into the frame and mustn't
bring part of the shell or a second Solid. It flips, clamps, and marks help tips the same way.

## The help mark

`SettingRow`, `SettingsSection`, `SectionHeader`, `Section`, `Heading`, and `Field` take `help`, a
string. With it, the node draws a small **?** after its title, and the text opens as a help tip on
hover, focus, and tap. That's where an explanation goes when it's useful but not needed at a glance.
The mark is `content/HelpMark.tsx`, internal to the kit, so a plugin passes `help` and never places a
mark itself.

The mark follows these rules:

- It's a real `<button>`: a tab stop that opens the tip on focus. A press focuses it, because WebKit
  doesn't focus a button on click and a touch screen has no hover.
- Its name is "About" plus the title, such as "About Stop idle agents after". Its description is the
  help text, so a screen reader gets the words without the bubble.
- It sits outside the element that names its host, so a row's or section's name doesn't gain "About".
- It's `--icon-size` in an `--icon-box` square, one line of a 12px label, so a row with a mark is no
  taller. It's `--text-muted` at rest and `--text` on hover and focus. The title and the mark share
  one `.ui-titled` box with a `--space-2` gap.
- The order is the title, the mark, then a count, the changed dot, or the scope chip.

Put each kind of text in its place:

- `description`: only what you need to choose correctly now, such as a consequence that can't be
  undone, a unit, or a format. One line, about 70 characters.
- `help`: how it works, when it applies, and why it exists. One to three short sentences, under about
  200 characters.
- Neither: text that restates the label, or describes how acorn is built instead of what you get.

On a `Field`, `hint` says what to type and `help` holds the why.
