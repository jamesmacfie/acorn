# Plugin keybindings — review fixes

Plugin keybindings shipped. `docs/command-palette-and-shortcuts.md` is the description of how the
system works; this file is the punch list from reviewing the implementation against what it was
built to do.

Four items. One is a user-visible regression, one is a broken test that predates this work and
matters more than the rest, two are small.

**What came out right**, so nobody re-litigates it: `eventChord`, `isTypingTarget` and the chord
grammar all live in `@acorn/protocol/keybindings.ts` and are shared by the manifest parser, the
shell dispatcher and the frame SDK rather than copied — the drift risk that would have quietly
broken the whole feature. Precedence is first-party, then plugins by lockfile `installedAt` with
plugin id as tiebreak, under a user-override tier, with `sourceIndex` making it stable across
reboots. Reserved claims (`escape`, `meta+k`, `meta+,`, `meta+1`–`9`) are refused at manifest
parse, and runtime `claim()` can only narrow the declared set. The bridge budget check runs before
the keydown branch, so a key flood trips the rate limiter. Manifest cross-validation catches
undeclared commands, double-bound commands and surface-scope mismatches.

---

## 1. Space is swallowed inside every plugin frame

**User-visible. Fix first.**

`eventChord` maps Space to `" "` — a single space character, non-null. The SDK's forwarder
(`packages/client-core/src/plugins/frames/sdk.ts`) therefore treats it as a real chord:

```ts
const chord = eventChord(event)            // " "
if (!chord || claimed.has(chord)) return   // passes: truthy, not claimable
if (isTypingTarget(event.target) && chord !== 'escape' && !hasCommandModifier(chord)) return
event.preventDefault()                     // ← the damage
port.postMessage({ kind: 'keydown', chord })
```

The broker then discards it, because `isNormalizedChord(" ")` is `false` — `parseChord` rejects
any value where `value.trim() !== value`:

```ts
if (data.kind === 'keydown') {
  if (typeof data.chord === 'string' && isNormalizedChord(data.chord)) services.keydown(data.chord)
  return
}
```

So Space is prevented in the frame and then thrown away by the host. Scroll-by-space is dead in
any plugin pane whose focus is not inside an input, and nothing is gained. Confirmed by running
both functions: `eventChord({code:'Space', key:' '})` → `" "`, `isNormalizedChord(" ")` → `false`.

### The underlying shape

`preventDefault()` runs unconditionally on every forwarded chord, before anyone knows whether a
binding exists. Space is the case where that is obviously wrong because the chord can never match
anything, but the same call also cancels the frame's default behaviour for any chord the shell
does not bind.

### Fix

Two changes in `onKeyDown`, both small:

1. **Do not forward what the host will reject.** Add `if (!isNormalizedChord(chord)) return`
   before the typing check. That alone fixes Space and every other `eventChord` output the
   grammar refuses, and it removes a class of "prevented for nothing" rather than one instance.
2. **Only prevent what could plausibly be a shortcut.** Restrict `preventDefault()` to chords
   carrying a command modifier, plus `escape`. Bare-key first-party bindings exist (`j`, `k`, `[`,
   `]`, `/`, `c`, all `typing-exempt` in the github plugin), so those must still *forward* — but
   forwarding does not require cancelling the frame's default, and cancelling it is what breaks a
   plugin's own bare-key UI.

Keep the existing typing-target guard as it is; it is correct.

### Tests

In `sdk.test.ts`, over the fake port:

- Space on a non-typing target: **not** forwarded, and `preventDefault` not called.
- `Tab` and `ArrowDown`: `eventChord` already returns null for arrows; assert Tab's behaviour
  explicitly so a future `baseKey` change cannot silently start eating focus navigation.
- A bare letter (`j`) on a non-typing target: forwarded, `preventDefault` **not** called.
- `meta+k`: forwarded and prevented.
- A claimed chord: neither forwarded nor prevented.

---

## 2. The Rollbar dogfood no longer loads

**Not caused by the keybinding work.** It arrived with the provider-seam change and has been red
since; this review is just where it surfaced. It is listed here because it is the most important
item in the file.

```
[plugin:rollbar] init failed; the plugin is disabled for this boot:
Error: Plugin 'rollbar' passed a Hono router to providers.integration; loaded plugins must pass a fetch handler.
    at Object.integration (packages/node-core/src/server/plugin/host.ts:149)
```

The gate is correct and doing exactly its job. What is stale is the plugin it is gating:
`plugins/rollbar/src/node/index.ts` still calls
`ctx.providers.integration(rollbarProvider, rollbar)` with a Hono router, and
`apps/node/scripts/build-plugin.mjs` bundles that source as the dogfood.

The casualty is `apps/node/test/integration/pluginLoader.test.ts`, which asserts that the loaded
Rollbar registers exactly as the compiled-in build does. It is the only test that exercises
install → load → register end to end, so **the loader currently has no working proof**, and the
fetch seam has no caller at all.

### Fix

Give Rollbar a fetch-shaped provider registration. Its routes already go through the plugin route
registry, and `PluginRequestContext` carries the identity and provider runtime they need, so this
is a wrapper rather than a rewrite. If the first-party build must keep the Hono form for now, have
`build-plugin.mjs` emit an adapter for the dogfood bundle instead — but prefer converting the
source, because the point of the dogfood is that it runs what a third-party plugin would run.

Do not "fix" this by relaxing the gate or by updating the test to expect a failure.

### Done when

`pnpm test` is back to the three documented environmental failures (`serviceSpawn` ×2,
`standaloneShutdown`), with `pluginLoader.test.ts` green.

---

## 3. `indexOf` inside a sort comparator

`packages/client-core/src/registries/keybindings.tsx`:

```ts
const sourceOrdered = [...bindings].sort((a, b) => {
  if (!a.plugin && !b.plugin) return bindings.indexOf(a) - bindings.indexOf(b)
  …
})
```

`Array.prototype.sort` has been stable since ES2019, so `return 0` preserves the original order
for two first-party bindings without an O(n) scan on every comparison. Cosmetic at the current
binding count; worth changing because the `indexOf` reads as though the stability is being
manufactured deliberately, which invites someone to preserve it during a future refactor.

---

## 4. Confirm the uninstall path for orphaned overrides

`shortcutSettingsModel.ts` computes orphans against the **unfiltered** registry:

```ts
const known = new Set(bindings.map((binding) => binding.id))
return Object.keys(overrides).filter((id) => id.startsWith('plugin.') && !known.has(id)).sort()
```

while `visibleShortcutBindings` hides rows whose plugin reports `state() === 'absent'`. So a
binding that is still registered but absent from the active Node is invisible **and** not offered
for cleanup.

For the multi-node case that is exactly right: the plugin still exists on another Node, and
offering to delete its settings would be wrong. It is only correct for a genuine uninstall if the
chrome adapter fully disposes those contributions, so the binding leaves the registry entirely.

### Test

One round trip: install a fixture plugin → override one of its chords → uninstall → assert the
override appears in `orphanedPluginOverrideIds` and the cleanup button counts it. If it does not,
the adapter is holding registrations past uninstall, which is the real bug and affects more than
shortcuts.

---

## Reference

- `packages/protocol/src/keybindings.ts` — the shared grammar, `eventChord`, `isTypingTarget`,
  reserved claims, id qualification.
- `packages/client-core/src/registries/keybindings.tsx` — resolution, precedence, dispatcher,
  `resolveFrameKeybinding`.
- `packages/client-core/src/plugins/frames/sdk.ts` — the forwarder; item 1 lives here.
- `packages/client-core/src/plugins/frames/broker.ts` — the host side of `keydown`.
- `packages/client-core/src/settings/ShortcutsSettings.tsx`, `shortcutSettingsModel.ts` — item 4.
- `packages/node-core/src/main/pluginManifest.ts` — `commands`, `keybindings`, `claimsKeys` and
  their cross-field validation.
- `docs/command-palette-and-shortcuts.md` — how the shipped system behaves.
