# Phase 3 — The frame boundary

**Size: L.** Requires phases 0–2. The hard one, and the one
[docs/third-party/editor.md](../third-party/editor.md) is blocked on: making keys work in both
directions across a sandboxed plugin frame.

## What is wrong

`KeybindingDispatcher` attaches one capture-phase `keydown` listener to `window` in the top frame.
**A keydown inside an iframe does not bubble to the parent window.** Different document, different
event target chain. So today, with a plugin frame focused:

- **Shell chords are dead.** `⌘K` for the palette, `⌘1`–`⌘9` for tasks, `⌘,` for settings — none
  of them fire while the user's focus is inside a plugin pane. From the user's point of view the
  app stops responding to its own shortcuts in one pane, which reads as a bug in the shell, not in
  the plugin.
- **Plugin chords never reach the dispatcher.** A phase-1 `surface`-scoped binding on a frame
  surface is declared, resolved, shown in Settings — and never fires, because the dispatcher never
  sees the event.

Both halves have to work, and they are different problems.

## Design

The frame is the only thing that sees its own keydowns, so the SDK has to forward them. The host
is the only thing that knows the binding table, so it has to decide. That gives one flow in each
direction over the existing port.

### Frame → host: forwarding

`@acorn/plugin-api/ui` attaches its own capture-phase listener inside the frame document and
forwards chords the frame does not want:

```ts
// in the SDK, running inside the frame
window.addEventListener('keydown', (event) => {
  const chord = eventChord(event)                    // the SAME function the shell uses
  if (!chord) return
  if (frameHandles(chord)) return                    // the plugin's own UI claimed it
  event.preventDefault()
  bridge.post({ kind: 'keydown', chord })            // let the shell decide
}, { capture: true })
```

Three decisions inside that:

- **Ship `eventChord` in the SDK.** Both sides must normalise identically or a chord means two
  different things. It is a pure function over a `KeyboardEvent`; move it somewhere both can
  import (`@acorn/protocol` alongside the chord validator phase 1 adds) rather than copying it.
- **`frameHandles` is the plugin's, and it is a list, not a callback.** The SDK exposes
  `acorn.keys.claim(['meta+f', 'meta+shift+f'])` — chords the frame's own UI handles, so the SDK
  stops forwarding them. Monaco's `⌘F` is the motivating case: the editor wants find-within-file,
  and the shell must not steal it. A list rather than a predicate keeps the decision inspectable
  and lets the host *see* what a frame has claimed.
- **Forward everything else, always.** Do not let the SDK filter to "chords the shell might want"
  — the frame does not know the binding table, and the table changes when the user rebinds.

### Host → dispatch

The broker receives `{ kind: 'keydown', chord }` and runs it through the existing resolution, with
the frame's binding as the scope context:

```ts
// broker, per frame
case 'keydown': {
  const binding = resolveForFrame(chord, binding.pluginId, binding.surface)
  if (binding) void executeCommand(binding.command)
  return
}
```

`resolveForFrame` reuses `resolveKeybindings` output. Two candidates can match: a `surface`-scoped
binding belonging to *this* plugin surface, and a `global` or `task` binding belonging to anyone.
Surface wins — it is the more specific scope, and it is the plugin's own pane.

**Rate-limit it.** Key events are the highest-frequency thing a frame can send; a stuck key or a
hostile frame should hit the existing bridge budget rather than the command dispatcher. The
budget is already there (`MAX_PER_WINDOW`); make sure keydown counts against it.

### Claimed chords and the shell

A frame claiming `meta+f` means the shell's `⌘F` does nothing while that frame has focus. That is
correct — it is the same behaviour a native app has — but it must be **visible in Settings**, or a
user whose global chord stops working in one pane has no way to find out why.

Add claims to the frame's manifest rather than only to the runtime call:

```jsonc
"frames": [{ "target": "pane", "id": "editor", …, "claimsKeys": ["meta+f", "meta+shift+f"] }]
```

Declared claims are shown in Settings → Shortcuts under the plugin's group ("Handled by the editor
pane: ⌘F, ⌘⇧F") and are visible at install time in the trust prompt's plugin section. The runtime
`claim()` call may only narrow the declared set, never extend it — otherwise a plugin can silently
capture any key once focused, which is a keylogging-adjacent capability and exactly the kind of
thing the manifest exists to make legible.

**Never claimable**, regardless of manifest: `meta+k` (palette), `meta+,` (settings), `meta+1`–`9`
(task switch), and `Escape`. A user must always be able to get out of a pane and open the palette.
Enforce that at manifest parse so a claim on a reserved chord is a parse error with a clear
message.

### Focus

The dispatcher's scope checks depend on `taskActive` and `focusedPane`, which the shell computes
from its own focus. When focus is inside an iframe, the top document's `activeElement` is the
`<iframe>` element itself — so "which pane is focused" still works, but "is a typing target
focused" does not: the shell cannot see the frame's inner focus.

That is why the SDK forwards rather than the shell guessing. But it means the typing-target check
for forwarded chords has to happen **inside the frame**: the SDK skips forwarding a bare-modifier
chord while its own focus is in an input, matching `isTypingTarget`'s intent. Ship that predicate
alongside `eventChord` for the same reason.

## What this does not do

- **No key sequences** (`⌘K ⌘S`). Same decision as phase 1.
- **No frame → frame keys.** A chord forwarded from one frame never dispatches into another.
- **No synthetic events into frames.** The shell does not inject keys downward; if a plugin needs
  to react to something, that is a command or a bridge event.

## Steps

1. Move `eventChord` and `isTypingTarget` to a shared location; both sides import one copy.
2. SDK: capture listener, claim list, typing guard, forwarding over the port.
3. Protocol: the `keydown` message in `pluginBridge.ts`.
4. Broker: handle it, resolve with surface precedence, count against the budget.
5. Manifest: `claimsKeys` per frame surface, with the reserved-chord refusal; runtime `claim()`
   narrowing only.
6. Settings: render claimed chords under the plugin's group.
7. Docs: `docs/command-palette-and-shortcuts.md` § Focus and typing gains the frame case;
   `docs/plugins.md` gains `claimsKeys`.

## Tests

- Chord parity: a table of `KeyboardEvent` shapes producing identical strings from the SDK copy
  and the shell copy. This is the test that stops the whole feature drifting.
- Forwarding: a chord not claimed reaches the broker; a claimed one does not; a chord typed into
  an input inside the frame does not.
- Dispatch: a `surface` binding wins over a `global` one on the same chord; a global shell chord
  (`⌘K`) fires while the frame has focus.
- Reserved: a manifest claiming `meta+k` fails to parse; a runtime `claim()` naming a chord not in
  the manifest is ignored and logged.
- Budget: a flood of keydowns trips the rate limit and the frame is killed with the existing
  placeholder, without taking the shell's key handling down.
- e2e, and this is the acceptance test for the editor move: with a plugin frame focused, `⌘K`
  opens the palette, the plugin's own chord runs its command, and `⌘F` goes to the frame.

## Exit criteria

- Shell chords work while a plugin frame has focus.
- Plugin `surface` bindings fire from inside their own frame.
- A frame can claim keys, only ones it declared, never the reserved set, and the user can see
  which.
