// Every keymap priority this host uses, with the sentence that says why each one is where it is.
//
// A tier is a number, and a number spelled at the call site is a decision nobody reviews. The
// baseline spelled ten of them across eight files, and the pair that collided — two Escapes at the
// region tier — worked only because of the order the two layers happened to register in. So the
// numbers live here, nothing else under `apps/tui/src` spells one, and `./tiers.test.ts` greps for a
// relapse (docs/tui.md § Keys and focus).
//
// Read top to bottom this is the order the engine asks in: the highest number answers first, and a
// handler that returns `false` hands the key to the next one down. Which is why a handler must return
// `false` when it changed nothing — a tier that claims a key it did nothing with is a key that does
// nothing at all, and that was five of the six reported keyboard symptoms
// (docs/tui.md § The five key groups).

/** An entered PTY, 200. Consumes everything, chords included, and consumes it before dispatch rather
 *  than from a layer, because it cannot name the keys it takes (../kit/rectangle.tsx). */
export const RECTANGLE = 200

/** The palette's own arrows, 61. A palette is a text box steered with the arrows, and it sits above
 *  the trap because the bare keys a collection would answer them with go inert the moment somebody
 *  is typing — which in a palette is always (./trap.ts § overlayKeys). */
export const OVERLAY_OWN = 61

/** `dismiss` inside a `Modal` or an open `MenuList`, 60. Escape closes the top scope before anything
 *  drawn inside it sees the key (./trap.ts, ./regions.ts § Scopes). */
export const TRAP = 60

/** A `Tabs` strip, 45. Above the collection a strip may be drawn over, so Left and Right on a strip
 *  sitting above a list change the tab rather than moving the list's rows (../kit/grouping.tsx). */
export const PARENT = 45

/** A `pressable`, 42. Above the collection tier rather than level with it: a `Button` inside a
 *  `Row` is inside the row's focus-within layer as well as its own focus layer, so both match the
 *  same Enter, and at equal priority the engine falls back to whichever of a container's ref and its
 *  children's refs the reconciler ran first (`@opentui/keymap` § compareLayers, ./stops.ts).
 *
 *  Two above rather than one, since the typing shadow took the number between them (§ TYPING). What
 *  it needed was a tier that every layer reaching a field from outside sits below and every layer
 *  bound to the field itself sits above, and a stop's layers are the second kind. */
export const STOP = 42

/**
 * The typing shadow, 41. Registered while an edit buffer has the keys and unregistered when it loses
 * them, and it binds the bare keys to a handler that claims them inside the keymap and lets the key
 * through to the field (`preventDefault: false`).
 *
 * A layer rather than a matcher, and that is a performance fact with a shape. `@opentui/keymap` 0.5.9
 * caches its active keys only while no registered layer, command or binding carries a runtime
 * matcher, and the counter is global — so one `active: () => !typing()` on one binding turned the
 * cache off for the whole process, and the footer, which asks per render, paid a full collect over
 * every active layer each time. Hundreds of bindings carried that matcher, one per bare key per
 * control on screen. One layer that comes and goes says the same thing and bumps the engine's cache
 * version twice per field rather than never letting it settle
 * (../../docs/future/performance/phase-9-the-terminal-clients-keystroke.md).
 *
 * The number is the whole of the design. Everything below it is a layer that reaches a focused field
 * from somewhere else — a collection around it, a viewport's page keys, the screen's own column
 * moves, the command layer's bare keys — and each of those has to go quiet while somebody types. The
 * two tiers above it, `STOP` and `PARENT`, are bound to an exact renderable by focus, and a field is
 * never the renderable they are bound to, with one deliberate exception: the suggestions list under a
 * `MentionTextarea`, whose `↓` is bound to the field itself and has to keep firing
 * (../kit/asking.tsx).
 */
export const TYPING = 41

/** A collection's own intents, 40, and the one row this file states without owning.
 *
 *  It is `registerIntentLayer`'s default in `client-core/kit/keys/keymapHost.ts`, which the desktop
 *  reads too, so both hosts answer a list's arrows at one number. Passing it from here would be a
 *  second place the number is written and the shared default would still be the one that decides.
 *  It is in the table because a table with a hole in it is a table nobody trusts (./collection.ts). */
export const COLLECTION = 40

/**
 * An open `Menu`'s own list walk, 36. Below the collection, so a menu whose caller drew a real `Rows`
 * inside it lets that list answer the arrows; above the viewport, so the walk beats the scroll
 * (../kit/grouping.tsx § MenuList).
 *
 * A known ceiling, recorded rather than gated. A scope contains the store's answers, not the engine's
 * layers: a `focus-within` layer on an *ancestor* of the open scope's box still matches, because
 * focus really is inside it. So with a `Menu` open inside a `ScrollViewport`, PageDown reaches the
 * viewport's page layer at `PANE` and scrolls the box the menu is drawn in. A `Modal` is drawn as a
 * sibling of the main row and has no such ancestor (../chrome/Shell.tsx), and no first-party surface
 * puts a `Menu` inside a viewport where that scroll reads as wrong, so nothing here gates. The
 * surface that would make it wrong is a menu whose own list is longer than the document it is drawn
 * inside; the fix then is to gate the layers that can be an ancestor of a scope on
 * `scopeDepth() === 1`, not to add another tier. The swallow layer this replaced ate that PageDown at
 * 35 and, being a table of named keys, leaked the ones it forgot
 * (docs/tui.md § Traps).
 */
export const LIST = 36

/** A pane's own keys, 30: a viewport's arrows and page keys, the `tabs` layout's Ctrl+1 to Ctrl+9, a
 *  split's resize chord, and a narrow `list-detail`'s group switch. Below every control drawn in the
 *  pane and above the screen's own keys. The ceiling the `LIST` row records is this tier's too, and
 *  the viewport layers are where it shows (../kit/scrolling.tsx). */
export const PANE = 30

/** The screen's keys, 5: Tab and Shift+Tab, the pane chords, Escape, and Left and Right as the last
 *  resort. One layer and one meaning per key. Two layers here is what made a notification's Escape
 *  and a region's Escape depend on which of them registered first (./install.ts). */
export const REGION = 5

/** The command registry and Ctrl+C, 0. Everything a reader can rebind, plus the one key a terminal
 *  sends to mean stop now (./commandLayer.ts, ../main.tsx). */
export const COMMAND = 0
