# A frame-verb table

**Strength: Worth exploring.** Real friction, proven pattern — but it touches a trust boundary, so
it earns a design pass before code.

## The problem, plainly

A sandboxed plugin frame talks to the host over a MessagePort. Everything it can do — fetch from
the Node API, show a toast, copy to clipboard, open a pane, open a URL — is a small vocabulary of
verbs. The trouble is where that vocabulary is written down: **five places**, one per module in the
pipeline.

| Spelling | Where |
|---|---|
| The wire message union | `packages/protocol/src/pluginBridge.ts` |
| The author-facing type (`AcornBridge`) | `frames/sdk.ts:56-135` |
| The author-facing implementation (the `api` literal) | `frames/sdk.ts:297-363` |
| The host-side contract (`FrameServices` + the dispatch switches) | `frames/broker.ts:61-99, 279-435` |
| The host-side implementation (`services()`) | `frames/PluginFrame.tsx:97-207` |

(Plus a sixth hop, `plugin-api/src/ui/sdk.ts`, which is a pure re-export.)

TypeScript stitches *some* of these pairs together, but not the chain end to end — the MessagePort
in the middle is untyped traffic, exactly like the HTTP wire in plan 2. So adding one verb means
five coordinated edits, and forgetting one doesn't fail the build.

This is not hypothetical. `frames/sdk.ts:42-45` documents the scar: **the protocol and the broker
both carried `PUT` from the start, and only the SDK facade didn't** — so plugin authors simply
couldn't make PUT requests, for no reason anyone had decided, until someone noticed.

The depth is also distributed wrong. `broker.ts` looks deep from outside (one function returning
`{dispose}`), but its inward half is shallow: `FrameServices` has 14 members that map one-for-one
onto the verbs its own switch dispatches — `toast` forwards to `services.toast`, `copy` to
`services.copy`, and so on. The switch validates, then forwards. A 14-member interface whose shape
restates the switch above it isn't hiding anything; it's the same information twice.

Meanwhile the *good* example is sitting in the same directory: `frames/scopes.ts` is 212 lines
with six exports, hiding a 40-entry rule table behind one function — `allowApi(binding, method,
path)`. One table, one interface, all the policy in data. That's the shape the verbs deserve.

## How it surfaces

You add a `download` verb so frames can save a file through the host:

1. Add the message shape to `pluginBridge.ts`.
2. Add the method to `AcornBridge` in `sdk.ts`.
3. Implement it in the `api` literal in `sdk.ts` (forget this one and you've re-created the PUT
   bug: the capability exists everywhere except where authors can reach it).
4. Add the member to `FrameServices` and a case to the broker switch (forget the case and the
   broker logs an unknown-kind denial at runtime — the author sees a rejected promise and starts
   debugging *their* code).
5. Implement the service in `PluginFrame.tsx` (untestable today — see plan 6).

Five files, two of which fail only at runtime, one of which fails only when a third-party author
complains. Each individual edit is trivial; the *coordination* is the tax, and it's charged per
verb forever.

## The plan

Design-first — steps 1–2 are a document, not a diff.

1. **Inventory the vocabulary.** Walk the broker's dispatch switches and list every verb with its
   request shape, response shape, validation, and budget/rate-limit class. This list probably fits
   on one screen, which is itself the argument for the table.
2. **Design `frames/verbs.ts` twice** (cheap at the design stage): e.g. (a) a declarative table
   `{ kind, paramsSchema, hostEffect: (services, params) => result }` that the broker iterates, vs
   (b) a typed map that `FrameServices` and `AcornBridge` are both *derived from* as mapped types,
   keeping the switch but making drift a compile error. Option (b) is less clever and keeps the
   runtime exactly as auditable as today — likely the right one for a trust boundary.
3. **Derive, don't restate.** Whichever design wins: `FrameServices` becomes a mapped type over the
   table, the sdk's `api` object is generated from (or type-checked against) it, and
   `pluginBridge.ts`'s union is asserted equivalent at the type level. One declaration, the other
   four spellings become derivations the compiler enforces.
4. **Migrate one verb group at a time** — `api.*` first (smallest surface), then `ui.*`. The wire
   format must not change; this is an internal reshuffle of who declares what.
5. **Lean on the existing suite.** `broker.test.ts` has 36 tests covering denial paths, rate
   limits, and disposal races. They are the behaviour lock: they must pass unmodified after each
   migration step.

## What gets better

- One edit per verb, and the compiler owns the coordination.
- The PUT class of drift — capability present in the protocol, absent from the author surface —
  becomes impossible to write.
- `FrameServices` stops being a hand-maintained restatement of the switch.

## Watch out for

- This is the sandbox's security membrane. The table must not make validation *implicit* — every
  verb's checks should remain as readable as today's switch. If the derived design obscures the
  denial paths, prefer the dumber option.
- Don't bundle this with plan 6. They touch the same files but are independently shippable, and
  each is easier to review alone.

## Files

- `packages/protocol/src/pluginBridge.ts`
- `packages/client-core/src/plugins/frames/sdk.ts:56-135, 297-363`
- `packages/client-core/src/plugins/frames/broker.ts:61-99, 279-435`
- `packages/client-core/src/plugins/frames/PluginFrame.tsx:97-207`
- `packages/client-core/src/plugins/frames/scopes.ts` — the in-repo proof of the table pattern
