# Terminal footer and key trace

This page covers the footer line that says what the keys will do, the cheat sheet, and the key trace
for debugging. It's part of [the terminal client](../tui.md).

## The footer

The footer lists the intents the focused thing accepts, with their primary keys, read off the keymap's
active layers. Nothing is declared twice. `activeHints()` reads the signals that change them: where the
keys are, whether an overlay has them, how many regions are in scope, whether you're typing, and the
engine's `state` event, which fires when focus moves or a layer changes. The list is cached against
those five, because the footer redraws whenever anything on screen does. One engine call returns the
keys and their descriptions together, with `includeMetadata`.

The words come from a table in `apps/tui/src/chrome/bindings.ts`, one row per kind of focused thing,
because the same key does different things in different places. `focusedKind()` asks the region store
which kind has the keys, in this order:

| What has the keys | `j`/`k` | `enter` | `h`/`l` | `ctrl+enter` |
| --- | --- | --- | --- | --- |
| A field, meaning an `Input` or a `Textarea` | move | press | type | send |
| A row of a collection | move | open | fold, or column | commit |
| A parent stop, meaning a strip showing a panel | `j` enter | press | tab | commit |
| A stop that opens a list, meaning a `Menu` trigger, so every `Select` | move | open | tab, or column | commit |
| A viewport holding no other stop | scroll | press | tab, or column | commit |
| Any other stop | move | press | tab, column, or move | commit |

A `Menu` says it opens a list by passing `opens` to `pressable`. The order is a priority: a field is a
stop too, and a viewport is a stop only while it holds none.

`words()` resolves the `h`/`l` column from three questions. A collection with an `onExpand` says
`fold`. A stop that answers `expand` and `collapse` itself, a horizontal collection drawn as one stop
such as `DocumentTabs`, `SegmentedControl`, or a chip row, says `move`. Anything else says `column`
where the pair can reach a column, which inside a panel leaves out the rail, and `tab` inside a panel
with none, because the strip answers there ([keys](./keys.md#the-five-key-groups)). A field's bare keys
type, so the footer draws only its chords.

While a PTY is entered, the footer says `esc leave · esc esc send escape`. The footer isn't a focus
stop, because there's nothing in it to drive.

Escape sits third. The footer cuts instead of wrapping, and the hints run move, act, back, the chords,
then the rest, so `esc back` shows on every screen. `reachability.test.tsx` reads the drawn line, not
the list, at every depth its walk visits.

A hint the top scope can't honor is dropped. Inside a `Modal` or an open `Menu`, the region tier's Tab
and column pair are still registered, and the engine reports them live. `regionsInScope() > 1` decides
both hints. The pair asks only where its word is `column`, because `fold`, `move`, and `tab` are
answered inside the scope.

The footer doesn't name the focused region. A `list-detail` pane draws two titled frames, and the lit
one already shows which half has the keys.

### The cheat sheet

`?` opens the cheat sheet, a dialog with the footer's own list in full and a sentence each. It calls
`activeHints()` and nothing else, so a binding in one is in the other. It takes a snapshot on open,
because the dialog pushes a scope as it draws. `chrome.test.tsx` checks both lists are equal in both
directions.

## Seeing what the keys did

`ACORN_TUI_KEYS_TRACE=1` writes one line per key to `keys.log` in the XDG state directory,
`$XDG_STATE_HOME/acorn/keys.log`, else `~/.local/state/acorn/keys.log`:

```text
17:08:29.001 key=f6      reason=binding-handled    focused=BoxRenderable#72 region=pane/body scope=overlay:2 steps=11
17:08:29.492 key=enter   reason=intercept-consumed focused=BoxRenderable#91 region=pane/body scope=screen    steps=0
```

Each line has the parsed key, what answered it and why, the node that had the keys, its region, how
many overlays deep the keys are, and how many nodes the store visited answering. It's a `key:after`
intercept in `apps/tui/src/keys/install.ts`, which runs once per key after dispatch and claims nothing.
It's registered without `release`, or every key would log twice. The log is a stream opened once, so
the trace doesn't slow the loop it measures.

Some lines are bugs wherever they appear. `reason=no-match` on a key the footer offers means the footer
is wrong. `region=none` while the screen has regions means nothing owns the keys. And the first line
above is one too: the region layer answered `f6` while an overlay held the keys, which is how a dialog
becomes unanswerable.

`steps=` should track the depth of the tree the keys are in, not the number of rows in the region. A
`steps` that grows with a list means a walk has started scanning. The counter in
`apps/tui/src/keys/regions.ts` is off unless this variable is set.

Turn this on first when someone says the keys stopped working.
